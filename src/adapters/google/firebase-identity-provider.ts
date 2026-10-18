import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { TenantIsolationError } from '../../domain/errors';
import { VerifiedActorSchema, type Role, type VerifiedActor } from '../../domain/schemas';
import type { IdentityProvider } from '../../ports/interfaces';

export class FirebaseIdentityProvider implements IdentityProvider {
  private readonly auth: Auth;

  constructor(auth?: Auth) {
    if (auth) {
      this.auth = auth;
    } else {
      if (getApps().length === 0) {
        initializeApp({
          projectId:
            process.env.FIREBASE_PROJECT_ID ??
            process.env.GOOGLE_CLOUD_PROJECT ??
            'demo-low-project',
        });
      }
      this.auth = getAuth();
    }
  }

  async verifyIdToken(token: string): Promise<VerifiedActor> {
    if (!token) {
      throw new TenantIsolationError('Missing authentication token');
    }
    const decoded = await this.auth.verifyIdToken(token, true);
    const parsed = VerifiedActorSchema.safeParse({
      uid: decoded.uid,
      orgId: decoded.orgId,
      role: decoded.role,
      ...(decoded.email ? { email: decoded.email } : {}),
    });

    if (!parsed.success) {
      throw new TenantIsolationError(
        `Token is missing valid tenant claims { orgId, role }: ${parsed.error.message}`
      );
    }
    return parsed.data;
  }

  async setTenantClaims(
    uid: string,
    claims: { orgId: string; role: Role }
  ): Promise<void> {
    await this.auth.setCustomUserClaims(uid, {
      orgId: claims.orgId,
      role: claims.role,
    });
  }
}
