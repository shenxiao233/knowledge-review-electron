import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { fail } from '../utils/response.js';

const prisma = new PrismaClient();

export class UserService {
  /**
   * Generate a unique UID in format: KR2607-A3X9
   * KR prefix + YYMM + dash + 4 alphanumeric chars
   */
  async generateUID(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const prefix = `KR${year}${month}`;
    
    for (let attempt = 0; attempt < 10; attempt++) {
      const suffix = crypto.randomBytes(3).toString('base64url').slice(0, 4).toUpperCase();
      const uid = `${prefix}-${suffix}`;
      const existing = await prisma.user.findUnique({ where: { uid } });
      if (!existing) return uid;
    }
    
    throw new Error('Failed to generate unique UID after 10 attempts');
  }

  /**
   * Complete user profile after registration
   */
  async completeProfile(userId: string, data: {
    nickname: string;
    avatar?: string;
    bio?: string;
    email?: string;
  }) {
    const validated = z.object({
      nickname: z.string().min(1).max(100),
      avatar: z.string().max(500).optional(),
      bio: z.string().max(1000).optional(),
      email: z.string().email().max(255).optional(),
    }).parse(data);

    const uid = await this.generateUID();

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        nickname: validated.nickname,
        avatar: validated.avatar,
        bio: validated.bio,
        email: validated.email,
        uid,
        status: 'ACTIVE',
      },
      select: {
        id: true, username: true, uid: true, nickname: true,
        avatar: true, bio: true, email: true, role: true, status: true,
      },
    });

    await prisma.auditLog.create({
      data: { userId, action: 'user.profile.complete', targetId: userId },
    });

    return user;
  }

  /**
   * Update user profile
   */
  async updateProfile(userId: string, data: {
    nickname?: string;
    avatar?: string;
    bio?: string;
    email?: string;
  }) {
    const validated = z.object({
      nickname: z.string().min(1).max(100).optional(),
      avatar: z.string().max(500).optional(),
      bio: z.string().max(1000).optional(),
      email: z.string().email().max(255).optional(),
    }).parse(data);

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(validated.nickname ? { nickname: validated.nickname } : {}),
        ...(validated.avatar !== undefined ? { avatar: validated.avatar } : {}),
        ...(validated.bio !== undefined ? { bio: validated.bio } : {}),
        ...(validated.email !== undefined ? { email: validated.email } : {}),
      },
      select: {
        id: true, username: true, uid: true, nickname: true,
        avatar: true, bio: true, email: true, role: true, status: true,
      },
    });

    await prisma.auditLog.create({
      data: { userId, action: 'user.profile.update', targetId: userId },
    });

    return user;
  }

  /**
   * Get user profile
   */
  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, uid: true, nickname: true,
        avatar: true, bio: true, email: true, role: true, status: true,
        createdAt: true, lastLoginAt: true,
        _count: {
          select: { decks: true, favorites: true, reviews: true },
        },
      },
    });

    if (!user) return null;
    return user;
  }

  /**
   * Register or update a device
   */
  async registerDevice(userId: string, data: {
    deviceType: string;
    deviceName: string;
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
  }) {
    const validated = z.object({
      deviceType: z.string().min(1).max(50),
      deviceName: z.string().min(1).max(100),
      deviceModel: z.string().max(100).optional(),
      osVersion: z.string().max(50).optional(),
      appVersion: z.string().max(50).optional(),
    }).parse(data);

    const device = await prisma.device.create({
      data: {
        userId,
        deviceType: validated.deviceType,
        deviceName: validated.deviceName,
        deviceModel: validated.deviceModel,
        osVersion: validated.osVersion,
        appVersion: validated.appVersion,
      },
    });

    return device;
  }

  /**
   * Update device last sync time
   */
  async updateDeviceSync(userId: string, deviceId: string) {
    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId },
    });
    if (!device) return null;

    return prisma.device.update({
      where: { id: device.id },
      data: { lastSyncAt: new Date() },
    });
  }

  /**
   * Get user's devices
   */
  async getDevices(userId: string) {
    return prisma.device.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
