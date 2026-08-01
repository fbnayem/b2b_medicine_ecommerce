import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    refreshTokenHash: { type: String, required: true },
    userAgent: { type: String },
    ipAddress: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    /** Why the session ended, so a user can tell a sign-out from a takeover. */
    revokedReason: {
      type: String,
      enum: [
        'SIGNED_OUT',
        'SIGNED_OUT_EVERYWHERE',
        'REVOKED_BY_ADMIN',
        'TOKEN_REUSE',
        'ROLE_CHANGED',
      ],
    },
    /** Set when the session rotates, so the timeline of a family is visible. */
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
);

// Listing a user's own sessions, and revoking every session on a role change,
// both query by user and are ordered by recency.
sessionSchema.index({ userId: 1, createdAt: -1 });

/**
 * Expired sessions are deleted by MongoDB rather than accumulating forever.
 * Revocation is checked on every authenticated request now, so the collection
 * is on the hot path and its size matters. The grace period keeps a session
 * readable for a short while after it expires, which is what makes reuse
 * detection able to recognise a stolen token instead of silently missing it.
 */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export const Session = mongoose.model('Session', sessionSchema);
