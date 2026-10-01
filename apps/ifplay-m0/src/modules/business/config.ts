import { z } from '@/core/zod';

export const partSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  desc: z.string().max(1000).optional(),
  cost: z.number().min(0),
});

export const customerSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  desc: z.string().max(1000).optional(),
  fault: z.string().max(1000),
  requiredPartId: z.string().min(1).max(64),
  reward: z.number().min(0),
  patience: z.number().int().min(1).max(100),
});

export const businessEventSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  desc: z.string().max(1000),
  weight: z.number().min(0).default(1),
  effects: z
    .array(
      z.object({
        type: z.enum(['addMoney', 'addReputation', 'message']),
        amount: z.number().optional(),
        text: z.string().max(500).optional(),
      }),
    )
    .max(20),
});

export const businessUpgradeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  desc: z.string().max(1000).optional(),
  cost: z.number().min(0),
  effects: z
    .array(
      z.object({
        type: z.enum(['addReputation', 'addMoney']),
        amount: z.number().optional(),
      }),
    )
    .max(10),
});

export const businessConfigSchema = z.object({
  labels: z.object({
    money: z.string().max(64),
    reputation: z.string().max(64),
    battery: z.string().max(64),
    turn: z.string().max(64),
  }),
  startMoney: z.number().min(0),
  startReputation: z.number().min(0),
  totalTurns: z.number().int().min(1).max(100),
  customersPerTurn: z.number().int().min(1).max(10),
  patienceDecay: z.number().int().min(0).max(50),
  reputationLossPerLeave: z.number().min(0),
  reputationGainPerRepair: z.number().min(0),
  reputationLossPerBadRepair: z.number().min(0),
  batteryStart: z.number().min(0),
  batteryCost: z.number().min(0),
  batteryRefill: z.number().int().min(1),
  initialParts: z.record(z.string(), z.number().int().min(0)),
  parts: z.array(partSchema).min(1).max(100),
  customers: z.array(customerSchema).min(1).max(200),
  upgrades: z.array(businessUpgradeSchema).max(50),
  events: z.array(businessEventSchema).max(100),
});

export type BusinessConfig = z.infer<typeof businessConfigSchema>;
