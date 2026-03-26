import { HttpException, HttpStatus } from '@nestjs/common';
import { Readable } from 'node:stream';
import { CvqaService } from './cvqa.service';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn5iHcAAAAASUVORK5CYII=',
  'base64',
);

const makeImageFile = (
  buffer: Buffer,
  filename = 'sample.png',
  mimetype = 'image/png',
): Express.Multer.File =>
  ({
    fieldname: 'file',
    originalname: filename,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
    stream: Readable.from(buffer),
    destination: '',
    filename,
    path: '',
  }) as unknown as Express.Multer.File;

describe('CvqaService', () => {
  let service: CvqaService;

  beforeEach(() => {
    service = new CvqaService({} as any);
    (service as any).model = {} as any;
  });

  it('reuses a single inline image part when object and golden are byte-identical', async () => {
    const generateSpy = jest
      .spyOn(service as any, 'generateContentWithRetry')
      .mockImplementation(async (request: any) => {
        const inlineParts = request.contents[0].parts.filter(
          (part: any) => part.inlineData,
        );
        expect(inlineParts).toHaveLength(1);
        return {
          response: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        status: 'PASS',
                        summary: 'Coincide',
                        issues: [],
                        missing: [],
                        confidence: 0.95,
                      }),
                    },
                  ],
                },
              },
            ],
          },
        };
      });

    const result = await service.compareVisionQuality(
      {
        object_file: [makeImageFile(TINY_PNG, 'object.png')],
        golden: [makeImageFile(TINY_PNG, 'golden.png')],
      },
      JSON.stringify({ rules: [] }),
      undefined,
      'org-1',
    );

    expect(generateSpy).toHaveBeenCalled();
    expect(result.status).toBe('PASS');
  });

  it('fails explicitly when Vertex compare exceeds the configured timeout budget', async () => {
    (service as any).compareTimeoutMs = 10;
    jest
      .spyOn(service as any, 'generateContentWithRetry')
      .mockImplementation(
        () => new Promise(() => undefined),
      );

    let caught: unknown;
    try {
      await service.compareVisionQuality(
        {
          object_file: [makeImageFile(TINY_PNG, 'object.png')],
        },
        JSON.stringify({ rules: [] }),
        undefined,
        'org-1',
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.GATEWAY_TIMEOUT);
  });
});
