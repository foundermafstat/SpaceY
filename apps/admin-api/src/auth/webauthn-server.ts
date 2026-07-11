import { Injectable } from "@nestjs/common";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

export const ADMIN_WEBAUTHN_SERVER = Symbol("spacey.admin-webauthn-server");

export interface AdminWebAuthnServer {
  generateAuthenticationOptions(
    options: Parameters<typeof generateAuthenticationOptions>[0],
  ): ReturnType<typeof generateAuthenticationOptions>;
  generateRegistrationOptions(
    options: Parameters<typeof generateRegistrationOptions>[0],
  ): ReturnType<typeof generateRegistrationOptions>;
  verifyAuthenticationResponse(
    options: Parameters<typeof verifyAuthenticationResponse>[0],
  ): ReturnType<typeof verifyAuthenticationResponse>;
  verifyRegistrationResponse(
    options: Parameters<typeof verifyRegistrationResponse>[0],
  ): ReturnType<typeof verifyRegistrationResponse>;
}

@Injectable()
export class SimpleWebAuthnServer implements AdminWebAuthnServer {
  generateAuthenticationOptions = generateAuthenticationOptions;
  generateRegistrationOptions = generateRegistrationOptions;
  verifyAuthenticationResponse = verifyAuthenticationResponse;
  verifyRegistrationResponse = verifyRegistrationResponse;
}
