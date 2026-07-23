import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ForbiddenError } from '../utils/errors.js';

const prisma = new PrismaClient();

export class CollabService {
  private async assertPullRequestAccess(userId: string, pullRequestId: string) {
    const pr = await prisma.deckPullRequest.findUnique({
      where: { id: pullRequestId },
      select: {
        createdById: true,
        sourceDeck: { select: { id: true, ownerId: true } },
        targetDeck: { select: { id: true, ownerId: true } },
      },
    });
    if (!pr) throw new Error('Pull request not found');
    if (pr.createdById === userId || pr.sourceDeck.ownerId === userId || pr.targetDeck.ownerId === userId) return;

    const collaboration = await prisma.deckCollaborator.findFirst({
      where: {
        userId,
        acceptedAt: { not: null },
        deckId: { in: [pr.sourceDeck.id, pr.targetDeck.id] },
      },
      select: { id: true },
    });
    if (!collaboration) throw new ForbiddenError('You are not authorized to access this pull request');
  }

  /**
   * Fork a deck
   */
  async forkDeck(userId: string, sourceDeckId: string, newTitle?: string) {
    const sourceDeck = await prisma.deck.findUnique({
      where: { id: sourceDeckId },
      include: {
        owner: { select: { username: true } },
        versions: {
          where: { status: 'PUBLISHED' },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!sourceDeck) throw new Error('Source deck not found');
    if (sourceDeck.status !== 'PUBLISHED') throw new Error('Only published decks can be forked');
    if (!sourceDeck.isForkable) throw new Error('This deck cannot be forked');

    const forkTitle = newTitle || `${sourceDeck.title} (Fork)`;

    // Create forked deck
    const forkedDeck = await prisma.deck.create({
      data: {
        ownerId: userId,
        title: forkTitle,
        description: sourceDeck.description,
        category: sourceDeck.category,
        status: 'DRAFT',
        isForkable: true,
        forkedFromId: sourceDeckId,
      },
    });

    // Create fork record
    await prisma.deckFork.create({
      data: {
        sourceDeckId,
        forkedDeckId: forkedDeck.id,
        forkedById: userId,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'deck.fork',
        targetId: forkedDeck.id,
        metadata: { sourceDeckId },
      },
    });

    return forkedDeck;
  }

  /**
   * Create a commit on a forked deck
   */
  async createCommit(userId: string, deckId: string, message: string, changes: any) {
    const deck = await prisma.deck.findUnique({
      where: { id: deckId, ownerId: userId },
    });

    if (!deck) throw new Error('Deck not found or you are not the owner');

    const validated = z.object({
      message: z.string().min(1).max(500),
      changes: z.any(),
    }).parse({ message, changes });

    const commit = await prisma.deckCommit.create({
      data: {
        deckId,
        authorId: userId,
        message: validated.message,
        changes: validated.changes,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'deck.commit',
        targetId: commit.id,
        metadata: { deckId },
      },
    });

    return commit;
  }

  /**
   * Create a pull request
   */
  async createPullRequest(userId: string, data: {
    sourceDeckId: string;
    targetDeckId: string;
    title: string;
    description: string;
  }) {
    const validated = z.object({
      sourceDeckId: z.string().uuid(),
      targetDeckId: z.string().uuid(),
      title: z.string().min(1).max(200),
      description: z.string().max(2000),
    }).parse(data);

    if (validated.sourceDeckId === validated.targetDeckId) {
      throw new Error('Source and target decks must be different');
    }

    // Verify source deck is owned by user
    const sourceDeck = await prisma.deck.findUnique({
      where: { id: validated.sourceDeckId, ownerId: userId },
    });
    if (!sourceDeck) throw new Error('Source deck not found or you are not the owner');

    // Verify target deck exists
    const targetDeck = await prisma.deck.findUnique({
      where: { id: validated.targetDeckId },
    });
    if (!targetDeck) throw new Error('Target deck not found');
    if (targetDeck.status === 'DISABLED') throw new Error('Disabled decks cannot receive pull requests');

    const pr = await prisma.deckPullRequest.create({
      data: {
        sourceDeckId: validated.sourceDeckId,
        targetDeckId: validated.targetDeckId,
        title: validated.title,
        description: validated.description,
        createdById: userId,
        status: 'OPEN',
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'deck.pr.create',
        targetId: pr.id,
        metadata: { sourceDeckId: validated.sourceDeckId, targetDeckId: validated.targetDeckId },
      },
    });

    return pr;
  }

  /**
   * Review a pull request
   */
  async reviewPullRequest(userId: string, pullRequestId: string, decision: string, comment?: string) {
    const validated = z.object({
      decision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']),
      comment: z.string().max(2000).optional(),
    }).parse({ decision, comment });

    const pr = await prisma.deckPullRequest.findUnique({
      where: { id: pullRequestId },
      include: { targetDeck: { select: { ownerId: true } } },
    });

    if (!pr) throw new Error('Pull request not found');
    if (pr.status !== 'OPEN') throw new Error('Pull request is not open');

    // Only target deck owner or collaborators can review
    const isTargetOwner = pr.targetDeck.ownerId === userId;
    const isCollaborator = await prisma.deckCollaborator.findFirst({
      where: { deckId: pr.targetDeckId, userId, acceptedAt: { not: null } },
    });

    if (!isTargetOwner && !isCollaborator) {
      throw new Error('You are not authorized to review this pull request');
    }

    const review = await prisma.deckPRReview.create({
      data: {
        pullRequestId,
        reviewerId: userId,
        decision: validated.decision,
        comment: validated.comment,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'deck.pr.review',
        targetId: review.id,
        metadata: { pullRequestId, decision: validated.decision },
      },
    });

    return review;
  }

  /**
   * Merge a pull request (target deck owner only)
   */
  async mergePullRequest(userId: string, pullRequestId: string) {
    const pr = await prisma.deckPullRequest.findUnique({
      where: { id: pullRequestId },
      include: {
        targetDeck: { select: { ownerId: true } },
        sourceDeck: { select: { id: true, title: true } },
      },
    });

    if (!pr) throw new Error('Pull request not found');
    if (pr.status !== 'OPEN') throw new Error('Pull request is not open');
    if (pr.targetDeck.ownerId !== userId) {
      throw new Error('Only the target deck owner can merge this pull request');
    }

    // Check if approved
    const reviews = await prisma.deckPRReview.findMany({
      where: { pullRequestId },
    });
    const hasApproval = reviews.some((r) => r.decision === 'APPROVED');

    if (!hasApproval) {
      throw new Error('Pull request must be approved before merging');
    }

    // Merge the PR
    const merged = await prisma.deckPullRequest.update({
      where: { id: pullRequestId },
      data: {
        status: 'MERGED',
        mergedById: userId,
        mergedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'deck.pr.merge',
        targetId: pullRequestId,
        metadata: { sourceDeckId: pr.sourceDeckId, targetDeckId: pr.targetDeckId },
      },
    });

    return merged;
  }

  /**
   * Close a pull request
   */
  async closePullRequest(userId: string, pullRequestId: string) {
    const pr = await prisma.deckPullRequest.findUnique({
      where: { id: pullRequestId },
    });

    if (!pr) throw new Error('Pull request not found');
    if (pr.status !== 'OPEN') throw new Error('Pull request is not open');
    if (pr.createdById !== userId) {
      throw new Error('Only the PR creator can close it');
    }

    const closed = await prisma.deckPullRequest.update({
      where: { id: pullRequestId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: { userId, action: 'deck.pr.close', targetId: pullRequestId },
    });

    return closed;
  }

  /**
   * Add a comment to a pull request
   */
  async addPRComment(userId: string, pullRequestId: string, content: string) {
    const validated = z.object({
      content: z.string().min(1).max(2000),
    }).parse({ content });

    await this.assertPullRequestAccess(userId, pullRequestId);
    const pr = await prisma.deckPullRequest.findUnique({ where: { id: pullRequestId } });

    if (!pr) throw new Error('Pull request not found');
    if (pr.status !== 'OPEN') throw new Error('Pull request is not open');

    const comment = await prisma.deckPRComment.create({
      data: {
        pullRequestId,
        authorId: userId,
        content: validated.content,
      },
    });

    await prisma.auditLog.create({
      data: { userId, action: 'deck.pr.comment', targetId: comment.id, metadata: { pullRequestId } },
    });

    return comment;
  }

  /**
   * Get pull request with all details
   */
  async getPullRequest(userId: string, pullRequestId: string) {
    await this.assertPullRequestAccess(userId, pullRequestId);
    return prisma.deckPullRequest.findUnique({
      where: { id: pullRequestId },
      include: {
        sourceDeck: { select: { id: true, title: true, owner: { select: { username: true } } } },
        targetDeck: { select: { id: true, title: true, owner: { select: { username: true } } } },
        createdBy: { select: { username: true } },
        reviews: {
          include: { reviewer: { select: { username: true } } },
          orderBy: { createdAt: 'desc' },
        },
        comments: {
          include: { author: { select: { username: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  /**
   * List pull requests for a deck
   */
  async listPullRequests(userId: string, deckId: string, status?: string) {
    const deck = await prisma.deck.findUnique({
      where: { id: deckId },
      select: { ownerId: true },
    });
    if (!deck) throw new Error('Deck not found');
    if (deck.ownerId !== userId) {
      const collaborator = await prisma.deckCollaborator.findFirst({
        where: { deckId, userId, acceptedAt: { not: null } },
        select: { id: true },
      });
      if (!collaborator) throw new ForbiddenError('You are not authorized to access this deck');
    }
    const where: any = {
      OR: [
        { sourceDeckId: deckId },
        { targetDeckId: deckId },
      ],
    };
    if (status) where.status = status;

    return prisma.deckPullRequest.findMany({
      where,
      include: {
        createdBy: { select: { username: true } },
        _count: { select: { reviews: true, comments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Invite a collaborator to a deck
   */
  async inviteCollaborator(userId: string, deckId: string, collaboratorId: string, role = 'editor') {
    const deck = await prisma.deck.findUnique({
      where: { id: deckId, ownerId: userId },
    });

    if (!deck) throw new Error('Deck not found or you are not the owner');

    const collaborator = await prisma.deckCollaborator.create({
      data: {
        deckId,
        userId: collaboratorId,
        role,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'deck.collaborator.invite',
        targetId: collaborator.id,
        metadata: { deckId, collaboratorId, role },
      },
    });

    return collaborator;
  }

  /**
   * Accept collaboration invitation
   */
  async acceptCollaboration(userId: string, deckId: string) {
    const collaborator = await prisma.deckCollaborator.update({
      where: { deckId_userId: { deckId, userId } },
      data: { acceptedAt: new Date() },
    });

    return collaborator;
  }

  /**
   * Remove a collaborator
   */
  async removeCollaborator(userId: string, deckId: string, collaboratorId: string) {
    const deck = await prisma.deck.findUnique({
      where: { id: deckId, ownerId: userId },
    });

    if (!deck) throw new Error('Deck not found or you are not the owner');

    await prisma.deckCollaborator.delete({
      where: { deckId_userId: { deckId, userId: collaboratorId } },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'deck.collaborator.remove',
        targetId: collaboratorId,
        metadata: { deckId },
      },
    });
  }
}
