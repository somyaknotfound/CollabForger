/**
 * User-related TypeScript interfaces for CollabForge.
 * No runtime implementation — types only.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
