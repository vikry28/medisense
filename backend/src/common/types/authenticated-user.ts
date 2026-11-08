export interface AuthenticatedUser {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: "USER" | "ADMIN";
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}
