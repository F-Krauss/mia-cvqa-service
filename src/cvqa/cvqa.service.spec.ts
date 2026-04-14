import { HttpException, HttpStatus } from '@nestjs/common';
import { Readable } from 'node:stream';
import sharp from 'sharp';
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

const makeJpegBuffer = async () =>
  sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  })
    .jpeg()
    .toBuffer();

describe('CvqaService', () => {
  let service: CvqaService;

  beforeEach(() => {
    service = new CvqaService({} as any);
    (service as any).models = [{ modelId: 'test-model', client: {} as any }];
  });

  it('reuses a single inline image part when object and golden are byte-identical', async () => {
    jest.spyOn(service as any, 'assessCaptureQuality').mockResolvedValue({
      status: 'PASS',
      blur: 0.9,
      exposure: 0.9,
      framing: 0.9,
      occlusion: null,
      issues: [],
    });
    const generateSpy = jest
      .spyOn(service as any, 'generateContentWithFallback')
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

  it('returns REVIEW when a multi_view_required rule receives only one evidence photo', async () => {
    const generateSpy = jest.spyOn(service as any, 'generateContentWithFallback');

    const result = await service.compareVisionQuality(
      {
        object_file: [makeImageFile(TINY_PNG, 'object.png')],
      },
      JSON.stringify({
        rules: [
          {
            id: 'rule-1',
            description: 'Verificar profundidad real',
            viewConstraint: 'multi_view_required',
            severity: 'critical',
          },
        ],
      }),
      undefined,
      'org-1',
    );

    expect(generateSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('REVIEW');
    expect(result.ruleResults[0]?.status).toBe('REVIEW');
  });

  it('returns annotated evidence images when the model provides rule evaluations', async () => {
    const jpegBuffer = await makeJpegBuffer();
    jest.spyOn(service as any, 'assessCaptureQuality').mockResolvedValue({
      status: 'PASS',
      blur: 0.92,
      exposure: 0.91,
      framing: 0.95,
      occlusion: null,
      issues: [],
    });
    jest
      .spyOn(service as any, 'generateContentWithFallback')
      .mockResolvedValue({
        modelId: 'test-model',
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      overallStatus: 'FAIL',
                      overallConfidence: 0.93,
                      summary: 'La pieza falla la regla de al ras.',
                      captureQuality: { status: 'PASS', issues: [] },
                      ruleResults: [
                        {
                          ruleId: 'rule-1',
                          status: 'FAIL',
                          confidence: 0.94,
                          reason: 'Sobresale del plano.',
                          sourceIndices: [0],
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        },
      });

    const result = await service.compareVisionQuality(
      {
        object_file: [makeImageFile(jpegBuffer, 'object.jpg', 'image/jpeg')],
      },
      JSON.stringify({
        rules: [
          {
            id: 'rule-1',
            description: 'El tornillo debe quedar al ras',
            severity: 'critical',
            checkType: 'flushness',
            paths: [[{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }]],
          },
        ],
      }),
      undefined,
      'org-1',
    );

    expect(result.status).toBe('FAIL');
    expect(result.annotatedImages?.length).toBe(1);
    expect(result.annotatedImages?.[0]?.url).toContain('data:image/jpeg;base64,');
  });

  it('fails explicitly when Vertex compare exceeds the configured timeout budget', async () => {
    (service as any).compareTimeoutMs = 10;
    jest.spyOn(service as any, 'assessCaptureQuality').mockResolvedValue({
      status: 'PASS',
      blur: 0.9,
      exposure: 0.9,
      framing: 0.9,
      occlusion: null,
      issues: [],
    });
    jest
      .spyOn(service as any, 'generateContentWithFallback')
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
