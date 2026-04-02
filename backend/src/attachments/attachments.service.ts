import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async saveLocalFile(
    uploaderId: string,
    file: Express.Multer.File,
  ) {
    const uploadsDir = join(process.cwd(), 'uploads');
    mkdirSync(uploadsDir, { recursive: true });

    const extension = extname(file.originalname) || '';
    const fileName = `${randomUUID()}${extension}`;
    const storageKey = fileName;
    const absolutePath = join(uploadsDir, fileName);

    await writeFile(absolutePath, file.buffer);

    return this.prisma.attachment.create({
      data: {
        uploaderId,
        storageKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: `/uploads/${fileName}`,
      },
    });
  }
}
