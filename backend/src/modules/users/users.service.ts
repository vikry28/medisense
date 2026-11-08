import { Injectable } from "@nestjs/common";
import { Prisma, User } from "@prisma/client";
import { ERROR_CODES } from "../../common/constants";
import { AppException } from "../../common/errors/app.exception";
import { hashPassword, verifyPassword } from "../../common/utils/password";
import { PrismaService } from "../../prisma/prisma.service";
import { toPublicUser } from "../auth/token.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw AppException.notFound(ERROR_CODES.NOT_FOUND, "User not found.");
    }
    return user;
  }

  async getProfile(id: string) {
    return toPublicUser(await this.findById(id));
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }
    if (dto.timezone !== undefined) {
      data.timezone = dto.timezone;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
    });
    return toPublicUser(user);
  }

  async changePassword(id: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.findById(id);
    const valid = await verifyPassword(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw AppException.unauthorized(
        ERROR_CODES.CREDENTIALS_INVALID,
        "The current password is incorrect.",
      );
    }

    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash },
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}
