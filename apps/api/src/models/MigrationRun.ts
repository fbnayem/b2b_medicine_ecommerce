import mongoose from 'mongoose';

export const MigrationRunStatus = {
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export const MigrationRunMode = {
  DRY_RUN: 'DRY_RUN',
  APPLY: 'APPLY',
} as const;

const schema = new mongoose.Schema(
  {
    migrationId: { type: String, required: true, index: true, immutable: true },
    runId: { type: String, required: true, unique: true, immutable: true },
    mode: {
      type: String,
      enum: Object.values(MigrationRunMode),
      required: true,
      immutable: true,
    },
    status: {
      type: String,
      enum: Object.values(MigrationRunStatus),
      required: true,
      default: MigrationRunStatus.RUNNING,
      index: true,
    },
    startedAt: { type: Date, required: true, immutable: true },
    completedAt: Date,
    stats: mongoose.Schema.Types.Mixed,
    anomalies: { type: [mongoose.Schema.Types.Mixed], default: [] },
    error: String,
  },
  { timestamps: true },
);

schema.index(
  { migrationId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: MigrationRunStatus.RUNNING },
  },
);
schema.index({ migrationId: 1, createdAt: -1 });

export const MigrationRun = mongoose.model('MigrationRun', schema);
