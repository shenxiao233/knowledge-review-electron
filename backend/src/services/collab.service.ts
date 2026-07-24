import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { storedPackagePath } from '../utils/storage.js';
import { sha256 } from '../utils/crypto.js';
import { ClientInputError, ForbiddenError } from '../utils/errors.js';

export class CollabService {
  /**
   * Push a card contribution to a published deck.
   * Any authenticated user can push — the deck owner reviews the card.
   */
  async pushCard(userId: string, deckId: string, data: {
    action: string;
    cardId: string;
    cardData: unknown;
  }) {
    const validated = z.object({
      action: z.enum(['ADD', 'MODIFY']),
      cardId: z.string().min(1).max(100),
      cardData: z.record(z.string(), z.any()),
    }).parse(data);

    const deck = await prisma.deck.findUnique({
      where: { id: deckId },
      select: { id: true, ownerId: true, status: true, publishedVersion: true },
    });
    if (!deck) throw new ClientInputError('Deck not found');
    if (deck.status !== 'PUBLISHED') throw new ClientInputError('Only published decks accept card contributions');

    // For MODIFY, verify the card exists in the current published version.
    if (validated.action === 'MODIFY') {
      const version = await prisma.deckVersion.findFirst({
        where: { deckId, status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: { packagePath: true },
      });
      if (!version) throw new ClientInputError('Deck has no published version');
      const cards = await this.readCardsFromPackage(storedPackagePath(version.packagePath));
      if (!cards.some((c: any) => String(c.id ?? c.cardId ?? '') === validated.cardId)) {
        throw new ClientInputError(`Card "${validated.cardId}" not found in this deck — use ADD instead`);
      }
    }

    // Prevent duplicate pending contributions for the same card by the same user.
    const existing = await prisma.cardContribution.findFirst({
      where: { deckId, contributorId: userId, cardId: validated.cardId, status: 'PENDING' },
      select: { id: true },
    });
    if (existing) throw new ClientInputError('You already have a pending contribution for this card');

    const contribution = await prisma.cardContribution.create({
      data: {
        deckId,
        contributorId: userId,
        action: validated.action,
        cardId: validated.cardId,
        cardData: validated.cardData,
        status: 'PENDING',
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'card.push',
        targetId: contribution.id,
        metadata: { deckId, cardId: validated.cardId, action: validated.action },
      },
    });

    return contribution;
  }

  /**
   * List card contributions for a deck.
   * The deck owner sees all; other users see only their own.
   */
  async listContributions(userId: string, deckId: string, status?: string) {
    const deck = await prisma.deck.findUnique({
      where: { id: deckId },
      select: { ownerId: true },
    });
    if (!deck) throw new ClientInputError('Deck not found');

    const where: any = { deckId };
    if (status) where.status = status;
    if (deck.ownerId !== userId) where.contributorId = userId;

    return prisma.cardContribution.findMany({
      where,
      include: {
        contributor: { select: { id: true, username: true, nickname: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * List all contributions by the current user across all decks.
   * Used for the "My Messages" feature — shows push status and review opinions.
   */
  async listMyContributions(userId: string) {
    return prisma.cardContribution.findMany({
      where: { contributorId: userId },
      include: {
        deck: { select: { id: true, title: true, ownerId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * List all contributions for decks owned by the current user (incoming review requests).
   */
  async listIncomingContributions(userId: string) {
    const deckIds = (await prisma.deck.findMany({
      where: { ownerId: userId },
      select: { id: true },
    })).map((d) => d.id);
    if (!deckIds.length) return [];
    return prisma.cardContribution.findMany({
      where: { deckId: { in: deckIds } },
      include: {
        deck: { select: { id: true, title: true } },
        contributor: { select: { id: true, username: true, nickname: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Get a single contribution's details.
   * Only the deck owner or the contributor can view.
   */
  async getContribution(userId: string, contributionId: string) {
    const contribution = await prisma.cardContribution.findUnique({
      where: { id: contributionId },
      include: {
        deck: { select: { ownerId: true, title: true } },
        contributor: { select: { id: true, username: true, nickname: true } },
      },
    });
    if (!contribution) throw new ClientInputError('Contribution not found');

    if (contribution.deck.ownerId !== userId && contribution.contributorId !== userId) {
      throw new ForbiddenError('You are not authorized to view this contribution');
    }
    return contribution;
  }

  /**
   * Review a card contribution (approve or reject).
   * Only the deck owner can review. On approval, the card is merged into the
   * deck's latest published version ZIP in place.
   */
  async reviewContribution(userId: string, contributionId: string, decision: string, note?: string, editedCardData?: unknown) {
    const validated = z.object({
      decision: z.enum(['APPROVED', 'REJECTED']),
      note: z.string().max(2000).optional(),
      editedCardData: z.record(z.string(), z.any()).optional(),
    }).parse({ decision, note, editedCardData });

    const contribution = await prisma.cardContribution.findUnique({
      where: { id: contributionId },
      include: { deck: { select: { id: true, ownerId: true, title: true } } },
    });
    if (!contribution) throw new ClientInputError('Contribution not found');
    if (contribution.deck.ownerId !== userId) {
      throw new ForbiddenError('Only the deck owner can review contributions');
    }
    if (contribution.status !== 'PENDING') {
      throw new ClientInputError('This contribution has already been reviewed');
    }

    // If approved, merge the card into the ZIP in place.
    // Use editedCardData if the owner modified the card during review.
    if (validated.decision === 'APPROVED') {
      const dataToMerge = validated.editedCardData || contribution.cardData;
      await this.mergeCardIntoDeck({
        ...contribution,
        cardData: dataToMerge,
      });
    }

    const updated = await prisma.cardContribution.update({
      where: { id: contributionId },
      data: {
        status: validated.decision,
        reviewerId: userId,
        reviewedAt: new Date(),
        reviewNote: validated.note,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'card.review',
        targetId: contributionId,
        metadata: {
          deckId: contribution.deckId,
          cardId: contribution.cardId,
          decision: validated.decision,
        },
      },
    });

    return updated;
  }

  // ─── Private helpers ───

  /**
   * Read and parse cards.json from a ZIP package on disk.
   */
  private async readCardsFromPackage(packagePath: string): Promise<any[]> {
    const zip = new AdmZip(packagePath);
    const cardsEntry = zip.getEntry('cards.json');
    if (!cardsEntry) throw new ClientInputError('Package missing cards.json');
    const cards = JSON.parse(cardsEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(cards)) throw new ClientInputError('cards.json must contain an array');
    return cards;
  }

  /**
   * Merge an approved card contribution into the deck's latest published
   * version ZIP, modifying the package in place.
   *
   * Uses a Postgres advisory lock on the deck to serialise concurrent
   * merges so the ZIP is not corrupted by overlapping writes.
   */
  private async mergeCardIntoDeck(contribution: {
    deckId: string;
    action: string;
    cardId: string;
    cardData: any;
  }) {
    return prisma.$transaction(async (tx) => {
      // Serialise concurrent merges on the same deck.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${contribution.deckId}))`;

      // Re-fetch the latest published version inside the lock.
      const version = await tx.deckVersion.findFirst({
        where: { deckId: contribution.deckId, status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: { id: true, packagePath: true, manifest: true },
      });
      if (!version) throw new ClientInputError('Deck has no published version to merge into');

      const packagePath = storedPackagePath(version.packagePath);
      try {
        await fsp.access(packagePath, fs.constants.R_OK);
      } catch {
        throw new ClientInputError('Deck package is missing from server storage');
      }

      // Read current cards from the ZIP.
      const zip = new AdmZip(packagePath);
      const cardsEntry = zip.getEntry('cards.json');
      if (!cardsEntry) throw new ClientInputError('Package missing cards.json');
      const cards: any[] = JSON.parse(cardsEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
      if (!Array.isArray(cards)) throw new ClientInputError('cards.json must contain an array');

      // Apply the contribution.
      let cardCountChanged = false;
      if (contribution.action === 'ADD') {
        // Avoid duplicate card IDs.
        if (cards.some((c) => String(c.id ?? c.cardId ?? '') === contribution.cardId)) {
          throw new ClientInputError(`Card "${contribution.cardId}" already exists in this deck`);
        }
        cards.push(contribution.cardData);
        cardCountChanged = true;
      } else {
        // MODIFY — replace the matching card.
        const idx = cards.findIndex((c) => String(c.id ?? c.cardId ?? '') === contribution.cardId);
        if (idx === -1) throw new ClientInputError(`Card "${contribution.cardId}" not found in the deck`);
        cards[idx] = contribution.cardData;
      }

      // Write updated cards.json back into the ZIP.
      const updatedCardsBuffer = Buffer.from(JSON.stringify(cards, null, 2), 'utf8');
      zip.deleteFile('cards.json');
      zip.addFile('cards.json', updatedCardsBuffer);

      // Update manifest.json cardCount if it changed.
      if (cardCountChanged) {
        const manifestEntry = zip.getEntry('manifest.json');
        if (manifestEntry) {
          const manifest = JSON.parse(manifestEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
          manifest.cardCount = cards.length;
          const updatedManifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
          zip.deleteFile('manifest.json');
          zip.addFile('manifest.json', updatedManifestBuffer);
        }
      }

      // Write the ZIP back to disk (overwrites the original in place).
      zip.writeZip(packagePath);

      // Recalculate sha256 and file size, update the DeckVersion record.
      const newHash = await sha256(packagePath);
      const stat = await fsp.stat(packagePath);
      await tx.deckVersion.update({
        where: { id: version.id },
        data: {
          sha256: newHash,
          packageSize: BigInt(stat.size),
          manifest: { ...(version.manifest as any), cardCount: cards.length },
        },
      });

      // Touch the parent Deck's updatedAt so the frontend shows the correct merge time.
      await tx.deck.update({
        where: { id: contribution.deckId },
        data: { updatedAt: new Date() },
      });
    });
  }
}
