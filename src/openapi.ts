/**
 * OpenAPI 3.1 specification for the Zebra Label Printer API.
 *
 * Served at GET /api/docs/openapi.json and rendered via Swagger UI at GET /api/docs.
 */

export const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Zebra Label Printer API',
    version: '0.1.0',
    description:
      'Network webhook API for the Zebra GK420d label printer. ' +
      'Print text labels, barcodes (1D + 2D/QR), raw ZPL, or compose ' +
      'custom labels from typed elements.',
    license: { name: 'MIT' }
  },
  servers: [
    { url: 'http://localhost:3420', description: 'Local server' },
    { url: 'http://{host}:3420', description: 'Network server',
      variables: { host: { default: 'nuc.local' } } }
  ],
  paths: {
    '/api/health': {
      get: {
        summary: 'Health check',
        operationId: 'healthCheck',
        tags: ['System'],
        responses: {
          '200': {
            description: 'Server is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    printer: { type: 'string', example: 'ZTC-GK420d' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/printers': {
      get: {
        summary: 'List available printers',
        operationId: 'listPrinters',
        tags: ['Discovery'],
        responses: {
          '200': {
            description: 'Available printers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    printers: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', example: 'ZTC-GK420d' },
                          uri: { type: 'string' },
                          model: { type: 'string' },
                          status: { type: 'string', enum: ['idle', 'printing', 'unavailable', 'unknown'] },
                          accepting: { type: 'boolean' },
                          serial: { type: 'string' },
                          isZebra: { type: 'boolean' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/print/text': {
      post: {
        summary: 'Print a text label',
        operationId: 'printText',
        tags: ['Printing'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lines'],
                properties: {
                  lines: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 20,
                    description: 'Lines of text to print',
                    example: ['Living Room', 'Box #3']
                  },
                  copies: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 10,
                    default: 1
                  }
                }
              },
              examples: {
                simple: {
                  summary: 'Simple label',
                  value: { lines: ['Kitchen Utensils'] }
                },
                multiLine: {
                  summary: 'Multi-line label',
                  value: { lines: ['Living Room', 'Box #3', 'Misc Cables'] }
                }
              }
            }
          }
        },
        responses: {
          '200': { $ref: '#/components/responses/PrintSuccess' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '503': { $ref: '#/components/responses/PrinterUnavailable' }
        }
      }
    },
    '/api/print/barcode': {
      post: {
        summary: 'Print a barcode label',
        operationId: 'printBarcode',
        tags: ['Printing'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: {
                    type: 'string',
                    description: 'Barcode data to encode',
                    example: 'INV-42069'
                  },
                  type: {
                    type: 'string',
                    enum: ['CODE128', 'CODE39', 'CODE93', 'EAN8', 'EAN13',
                      'UPCA', 'UPCE', 'CODABAR', 'PDF417', 'QRCODE', 'DATAMATRIX'],
                    default: 'CODE128'
                  },
                  text: {
                    type: 'string',
                    description: 'Optional human-readable text below the barcode'
                  },
                  height: {
                    type: 'integer',
                    minimum: 10,
                    maximum: 1000,
                    description: 'Barcode height in dots'
                  }
                }
              },
              examples: {
                code128: {
                  summary: 'CODE128 barcode',
                  value: { data: 'INV-42069', text: 'Inventory Tag' }
                }
              }
            }
          }
        },
        responses: {
          '200': { $ref: '#/components/responses/PrintSuccess' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '503': { $ref: '#/components/responses/PrinterUnavailable' }
        }
      }
    },
    '/api/print/qr': {
      post: {
        summary: 'Print a QR code label',
        operationId: 'printQR',
        tags: ['Printing'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: {
                    type: 'string',
                    description: 'Data to encode in the QR code',
                    example: 'https://example.com'
                  },
                  text: {
                    type: 'string',
                    description: 'Optional label text below the QR code'
                  },
                  magnification: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 10,
                    default: 5,
                    description: 'QR code size multiplier'
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': { $ref: '#/components/responses/PrintSuccess' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '503': { $ref: '#/components/responses/PrinterUnavailable' }
        }
      }
    },
    '/api/print/zpl': {
      post: {
        summary: 'Print raw ZPL',
        operationId: 'printZPL',
        tags: ['Printing'],
        description:
          'Send raw ZPL (Zebra Programming Language) commands directly to the printer. ' +
          'Accepts either a raw ZPL string or a JSON object with a "zpl" field.',
        requestBody: {
          required: true,
          content: {
            'text/plain': {
              schema: { type: 'string', example: '^XA\n^FO50,50^A0N,40,40^FDHello^FS\n^XZ' }
            },
            'application/json': {
              schema: {
                type: 'object',
                required: ['zpl'],
                properties: { zpl: { type: 'string' } }
              }
            }
          }
        },
        responses: {
          '200': { $ref: '#/components/responses/PrintSuccess' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '503': { $ref: '#/components/responses/PrinterUnavailable' }
        }
      }
    },
    '/api/print/label': {
      post: {
        summary: 'Print a composed label from elements',
        operationId: 'printLabel',
        tags: ['Printing'],
        description:
          'Compose a label from typed elements (text, barcode, qrcode, raw ZPL). ' +
          'Each element specifies its type, content, and position options.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['elements'],
                properties: {
                  elements: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      oneOf: [
                        {
                          type: 'object',
                          title: 'Text',
                          required: ['type', 'content', 'options'],
                          properties: {
                            type: { const: 'text' },
                            content: { type: 'string' },
                            options: {
                              type: 'object',
                              required: ['x', 'y'],
                              properties: {
                                x: { type: 'integer' },
                                y: { type: 'integer' },
                                font: { type: 'string' },
                                height: { type: 'integer' },
                                width: { type: 'integer' },
                                rotation: { type: 'string', enum: ['N', 'R', 'I', 'B'] },
                                reverse: { type: 'boolean' }
                              }
                            }
                          }
                        },
                        {
                          type: 'object',
                          title: 'Barcode',
                          required: ['type', 'content', 'options'],
                          properties: {
                            type: { const: 'barcode' },
                            content: { type: 'string' },
                            options: {
                              type: 'object',
                              required: ['x', 'y', 'type'],
                              properties: {
                                x: { type: 'integer' },
                                y: { type: 'integer' },
                                type: { type: 'string', enum: ['CODE128', 'CODE39', 'CODE93', 'EAN8', 'EAN13', 'UPCA', 'UPCE', 'CODABAR', 'PDF417', 'QRCODE', 'DATAMATRIX'] },
                                height: { type: 'integer' },
                                humanReadable: { type: 'boolean' },
                                rotation: { type: 'string', enum: ['N', 'R', 'I', 'B'] }
                              }
                            }
                          }
                        },
                        {
                          type: 'object',
                          title: 'QR Code',
                          required: ['type', 'content', 'options'],
                          properties: {
                            type: { const: 'qrcode' },
                            content: { type: 'string' },
                            options: {
                              type: 'object',
                              required: ['x', 'y'],
                              properties: {
                                x: { type: 'integer' },
                                y: { type: 'integer' },
                                magnification: { type: 'integer', minimum: 1, maximum: 10 },
                                errorCorrection: { type: 'string', enum: ['L', 'M', 'Q', 'H'] }
                              }
                            }
                          }
                        },
                        {
                          type: 'object',
                          title: 'Raw ZPL',
                          required: ['type', 'zpl'],
                          properties: {
                            type: { const: 'raw' },
                            zpl: { type: 'string' }
                          }
                        }
                      ]
                    }
                  },
                  copies: { type: 'integer', minimum: 1, maximum: 10 }
                }
              },
              examples: {
                simple: {
                  summary: 'Text + barcode',
                  value: {
                    elements: [
                      { type: 'text', content: 'Asset Tag', options: { x: 50, y: 30, height: 40 } },
                      { type: 'barcode', content: 'ASSET-001', options: { x: 50, y: 90, type: 'CODE128', height: 80 } }
                    ]
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': { $ref: '#/components/responses/PrintSuccess' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '503': { $ref: '#/components/responses/PrinterUnavailable' }
        }
      }
    }
  },
  components: {
    responses: {
      PrintSuccess: {
        description: 'Label sent to printer',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', example: true },
                jobId: { type: 'string', example: 'ZTC-GK420d-3' }
              }
            }
          }
        }
      },
      PrintFailure: {
        description: 'Print failed',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { const: false },
                error: { type: 'string' }
              }
            }
          }
        }
      },
      ValidationError: {
        description: 'Invalid request body',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string' },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      field: { type: 'string' },
                      message: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      PrinterUnavailable: {
        description: 'No printer connected',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { const: false },
                error: { type: 'string', example: 'No printer connected' }
              }
            }
          }
        }
      }
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API key set via ZEBRA_API_KEY environment variable'
      }
    }
  },
  security: [],
  tags: [
    { name: 'System', description: 'Health and status endpoints' },
    { name: 'Discovery', description: 'Printer discovery' },
    { name: 'Printing', description: 'Label printing endpoints' }
  ]
} as const

/**
 * HTML page that renders Swagger UI from the OpenAPI spec.
 */
export function swaggerUiHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Zebra Label Printer API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    SwaggerUIBundle({
      url: '${specUrl}',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "StandaloneLayout",
      defaultModelsExpandDepth: -1,
    });
  </script>
</body>
</html>`
}
