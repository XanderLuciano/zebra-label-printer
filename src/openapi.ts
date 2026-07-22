/**
 * OpenAPI 3.1 specification for the Zebra Label Printer API.
 *
 * Served at GET /api/docs/openapi.json and rendered via Swagger UI at GET /api/docs.
 */

export const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Zebra Label Printer API',
    version: '0.1.1',
    description:
      'Network webhook API for the Zebra GK420d label printer. ' +
      'Print text labels, barcodes (1D + 2D/QR), raw ZPL, or compose ' +
      'custom labels from typed elements. Design reusable, auto-scaling ' +
      'label templates and render ZPL to preview it without printing.',
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
                    items: { $ref: '#/components/schemas/LabelElement' }
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
    },
    '/api/render/zpl': {
      post: {
        summary: 'Render composed elements to ZPL (no printing)',
        operationId: 'renderZpl',
        tags: ['Rendering'],
        description:
          'Build the ZPL for a composed label without sending it to the printer. ' +
          'Useful for previews (e.g. rendering the ZPL to an image via Labelary) ' +
          'and for inspecting the generated commands.',
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
                    items: { $ref: '#/components/schemas/LabelElement' }
                  },
                  copies: { type: 'integer', minimum: 1, maximum: 10 },
                  widthDots: { type: 'integer', minimum: 1, description: 'Label width in dots (defaults to the configured label size)' },
                  heightDots: { type: 'integer', minimum: 1, description: 'Label height in dots (defaults to the configured label size)' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Generated ZPL',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    zpl: { type: 'string', example: '^XA\n^LL203\n^PW406\n^FO10,10^A0N,30,24^FDHello^FS\n^XZ' },
                    widthDots: { type: 'integer', example: 406 },
                    heightDots: { type: 'integer', example: 203 }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/ValidationError' }
        }
      }
    },
    '/api/templates': {
      get: {
        summary: 'List label templates',
        operationId: 'listTemplates',
        tags: ['Templates'],
        responses: {
          '200': {
            description: 'All saved templates',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    templates: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/StoredTemplate' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        summary: 'Create a label template',
        operationId: 'createTemplate',
        tags: ['Templates'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TemplateDefinition' }
            }
          }
        },
        responses: {
          '201': { $ref: '#/components/responses/TemplateResponse' },
          '400': { $ref: '#/components/responses/ValidationError' }
        }
      }
    },
    '/api/templates/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Template id' }
      ],
      get: {
        summary: 'Get a label template',
        operationId: 'getTemplate',
        tags: ['Templates'],
        responses: {
          '200': { $ref: '#/components/responses/TemplateResponse' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      },
      put: {
        summary: 'Update a label template',
        operationId: 'updateTemplate',
        tags: ['Templates'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TemplateDefinition' }
            }
          }
        },
        responses: {
          '200': { $ref: '#/components/responses/TemplateResponse' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      },
      delete: {
        summary: 'Delete a label template',
        operationId: 'deleteTemplate',
        tags: ['Templates'],
        responses: {
          '200': {
            description: 'Template deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { const: true } }
                }
              }
            }
          },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      }
    },
    '/api/print/serial': {
      post: {
        summary: 'Print serialized labels',
        operationId: 'printSerial',
        tags: ['Printing'],
        description:
          'Print multiple text labels with an auto-incrementing serial number. ' +
          'Use the {serial} placeholder in any line; it is replaced per copy, ' +
          'zero-padded to the width of serialFormat.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lines', 'copies'],
                properties: {
                  lines: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 20,
                    example: ['Widget', 'SN: {serial}']
                  },
                  copies: { type: 'integer', minimum: 1, maximum: 500 },
                  serialStart: { type: 'integer', minimum: 0, default: 1 },
                  serialFormat: { type: 'string', enum: ['#', '##', '###', '####', '#####'], default: '###' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Serial batch queued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { const: true },
                    totalCopies: { type: 'integer' },
                    serialStart: { type: 'integer' },
                    serialEnd: { type: 'integer' },
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          copy: { type: 'integer' },
                          serial: { type: 'string' },
                          jobId: { type: 'string' },
                          queued: { type: 'boolean' }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '503': { $ref: '#/components/responses/PrinterUnavailable' }
        }
      }
    },
    '/api/jobs': {
      get: {
        summary: 'List print jobs',
        operationId: 'listJobs',
        tags: ['Jobs'],
        parameters: [
          { name: 'status', in: 'query', required: false, schema: { $ref: '#/components/schemas/JobStatus' }, description: 'Filter by job status' },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50, maximum: 200 } },
          { name: 'offset', in: 'query', required: false, schema: { type: 'integer', default: 0 } }
        ],
        responses: {
          '200': {
            description: 'Jobs and aggregate stats',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jobs: { type: 'array', items: { $ref: '#/components/schemas/PrintJob' } },
                    stats: { $ref: '#/components/schemas/JobStats' }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/ValidationError' }
        }
      }
    },
    '/api/jobs/stats': {
      get: {
        summary: 'Job statistics',
        operationId: 'jobStats',
        tags: ['Jobs'],
        responses: {
          '200': {
            description: 'Counts by status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobStats' }
              }
            }
          }
        }
      }
    },
    '/api/jobs/clear': {
      post: {
        summary: 'Clear jobs by status or age',
        operationId: 'clearJobs',
        tags: ['Jobs'],
        description: 'Bulk-remove jobs. Provide olderThanDays to prune by age, or a status to clear.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['completed', 'failed', 'cancelled', 'all'], default: 'completed' },
                  olderThanDays: { type: 'integer', minimum: 1, maximum: 365 }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Jobs cleared',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { const: true }, deleted: { type: 'integer' } }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/ValidationError' }
        }
      },
      delete: {
        summary: 'Clear jobs by status or age',
        operationId: 'clearJobsDelete',
        tags: ['Jobs'],
        description: 'Same as POST /api/jobs/clear; provided for REST-style clients.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['completed', 'failed', 'cancelled', 'all'], default: 'completed' },
                  olderThanDays: { type: 'integer', minimum: 1, maximum: 365 }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Jobs cleared',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { const: true }, deleted: { type: 'integer' } }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/ValidationError' }
        }
      }
    },
    '/api/jobs/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Job id' }
      ],
      get: {
        summary: 'Get a job with its logs',
        operationId: 'getJob',
        tags: ['Jobs'],
        responses: {
          '200': {
            description: 'Job detail',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    job: { $ref: '#/components/schemas/PrintJob' },
                    logs: { type: 'array', items: { $ref: '#/components/schemas/JobLogEntry' } }
                  }
                }
              }
            }
          },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      },
      delete: {
        summary: 'Delete a job',
        operationId: 'deleteJob',
        tags: ['Jobs'],
        responses: {
          '200': {
            description: 'Job deleted',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { success: { const: true } } }
              }
            }
          },
          '500': { description: 'Failed to delete job' }
        }
      }
    },
    '/api/jobs/{id}/cancel': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Job id' }
      ],
      post: {
        summary: 'Cancel a pending job',
        operationId: 'cancelJob',
        tags: ['Jobs'],
        responses: {
          '200': {
            description: 'Cancellation result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean' }, message: { type: 'string' } }
                }
              }
            }
          }
        }
      }
    },
    '/api/settings': {
      get: {
        summary: 'Get all settings',
        operationId: 'getSettings',
        tags: ['Settings'],
        responses: {
          '200': {
            description: 'Key/value settings map',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: { type: 'string' } }
              }
            }
          }
        }
      },
      put: {
        summary: 'Update settings',
        operationId: 'updateSettings',
        tags: ['Settings'],
        description: 'Merge the provided key/value pairs into the settings store. Values are stored as strings.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: true },
              examples: {
                toggle: { summary: 'Persist a preference', value: { serialize_labels: 'true' } }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Settings updated',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { success: { const: true } } }
              }
            }
          },
          '400': { $ref: '#/components/responses/ValidationError' }
        }
      }
    },
    '/api/label-size': {
      get: {
        summary: 'Get the current label size',
        operationId: 'getLabelSize',
        tags: ['Settings'],
        responses: {
          '200': {
            description: 'Current, recent, and standard sizes',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    current: { $ref: '#/components/schemas/LabelSize' },
                    recents: { type: 'array', items: { $ref: '#/components/schemas/LabelSize' } },
                    standards: { type: 'array', items: { $ref: '#/components/schemas/LabelSize' } },
                    dpi: { type: 'integer', example: 203 }
                  }
                }
              }
            }
          }
        }
      },
      put: {
        summary: 'Set the current label size',
        operationId: 'setLabelSize',
        tags: ['Settings'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['widthDots', 'heightDots'],
                properties: {
                  widthDots: { type: 'integer', minimum: 100 },
                  heightDots: { type: 'integer', minimum: 50 },
                  name: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Size saved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { const: true },
                    size: { $ref: '#/components/schemas/LabelSize' }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/ValidationError' }
        }
      }
    },
    '/api/debug': {
      get: {
        summary: 'System diagnostics',
        operationId: 'getDebug',
        tags: ['System'],
        responses: {
          '200': {
            description: 'Printer, queue, database, and server diagnostics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    printer: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        isReady: { type: 'boolean' }
                      }
                    },
                    queue: {
                      type: 'object',
                      properties: {
                        pending: { type: 'integer' },
                        processorRunning: { type: 'boolean' }
                      }
                    },
                    database: {
                      type: 'object',
                      properties: {
                        path: { type: 'string' },
                        sizeBytes: { type: 'integer' },
                        sizeFormatted: { type: 'string' },
                        stats: { $ref: '#/components/schemas/JobStats' }
                      }
                    },
                    server: {
                      type: 'object',
                      properties: {
                        uptime: { type: 'number' },
                        memory: { type: 'object', additionalProperties: true },
                        nodeVersion: { type: 'string' }
                      }
                    },
                    printerEvents: { type: 'array', items: { type: 'object', additionalProperties: true } }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/version': {
      get: {
        summary: 'Version and update availability',
        operationId: 'getVersion',
        tags: ['Maintenance'],
        description: 'Returns current/latest version info (cached).',
        responses: {
          '200': {
            description: 'Version info',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/VersionInfo' }
              }
            }
          }
        }
      }
    },
    '/api/update/check': {
      post: {
        summary: 'Force an update check',
        operationId: 'checkForUpdates',
        tags: ['Maintenance'],
        description: 'Checks for a newer release, bypassing the cache.',
        responses: {
          '200': {
            description: 'Version info',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/VersionInfo' }
              }
            }
          }
        }
      }
    },
    '/api/update/install': {
      post: {
        summary: 'Install the latest update',
        operationId: 'installUpdate',
        tags: ['Maintenance'],
        description:
          'Pulls the latest code, installs production dependencies, and rebuilds. ' +
          'The server must be restarted afterward to apply changes.',
        responses: {
          '200': {
            description: 'Update installed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { const: true },
                    message: { type: 'string' },
                    details: {
                      type: 'object',
                      properties: {
                        pull: { type: 'string' },
                        install: { type: 'string' },
                        build: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          },
          '500': {
            description: 'Update failed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { const: false }, error: { type: 'string' } }
                }
              }
            }
          }
        }
      }
    },
    '/api/docs': {
      get: {
        summary: 'Swagger UI',
        operationId: 'docsUi',
        tags: ['System'],
        responses: {
          '200': {
            description: 'Interactive API documentation (HTML)',
            content: { 'text/html': { schema: { type: 'string' } } }
          }
        }
      }
    },
    '/api/docs/openapi.json': {
      get: {
        summary: 'OpenAPI specification',
        operationId: 'openApiSpec',
        tags: ['System'],
        responses: {
          '200': {
            description: 'This OpenAPI 3.1 document',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      // ── Composed label elements (shared by /print/label and /render/zpl) ──
      LabelElementText: {
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
              ratio: { type: 'number', minimum: 0.1, maximum: 3.0 },
              rotation: { type: 'string', enum: ['N', 'R', 'I', 'B'] },
              reverse: { type: 'boolean' }
            }
          }
        }
      },
      LabelElementBarcode: {
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
              type: { $ref: '#/components/schemas/BarcodeType' },
              height: { type: 'integer' },
              narrowBarWidth: { type: 'integer', minimum: 1, maximum: 10 },
              wideBarRatio: { type: 'number', minimum: 2, maximum: 3 },
              humanReadable: { type: 'boolean' },
              humanReadablePosition: { type: 'string', enum: ['Y', 'N'] },
              rotation: { type: 'string', enum: ['N', 'R', 'I', 'B'] }
            }
          }
        }
      },
      LabelElementQr: {
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
      LabelElementRaw: {
        type: 'object',
        title: 'Raw ZPL',
        required: ['type', 'zpl'],
        properties: {
          type: { const: 'raw' },
          zpl: { type: 'string' }
        }
      },
      LabelElement: {
        oneOf: [
          { $ref: '#/components/schemas/LabelElementText' },
          { $ref: '#/components/schemas/LabelElementBarcode' },
          { $ref: '#/components/schemas/LabelElementQr' },
          { $ref: '#/components/schemas/LabelElementRaw' }
        ]
      },
      BarcodeType: {
        type: 'string',
        enum: ['CODE128', 'CODE39', 'CODE93', 'EAN8', 'EAN13',
          'UPCA', 'UPCE', 'CODABAR', 'PDF417', 'QRCODE', 'DATAMATRIX']
      },

      // ── Templates ──────────────────────────────────────────────────────
      TemplateVariable: {
        type: 'object',
        description: 'A named input variable; referenced in content as {{name}}.',
        required: ['name'],
        properties: {
          name: { type: 'string', pattern: '^[A-Za-z0-9_]+$', example: 'partNumber' },
          label: { type: 'string', description: 'Display label', example: 'Part Number' },
          sample: { type: 'string', description: 'Mock value used for previews', example: '135853-002' }
        }
      },
      TemplateElementBase: {
        type: 'object',
        description: 'Common fields. Positions/sizes are percentages of the label dimensions (0–100), so a design auto-scales to any size.',
        required: ['id', 'xPct', 'yPct'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          xPct: { type: 'number', minimum: -50, maximum: 150 },
          yPct: { type: 'number', minimum: -50, maximum: 150 },
          rotation: { type: 'string', enum: ['N', 'R', 'I', 'B'] },
          hidden: { type: 'boolean' }
        }
      },
      TemplateElementText: {
        allOf: [
          { $ref: '#/components/schemas/TemplateElementBase' },
          {
            type: 'object',
            required: ['type', 'content', 'fontHeightPct'],
            properties: {
              type: { const: 'text' },
              content: { type: 'string', description: 'May contain {{variable}} tokens' },
              fontHeightPct: { type: 'number', minimum: 0.5, maximum: 100, description: 'Font height as a percentage of label height' },
              ratio: { type: 'number', minimum: 0.1, maximum: 3.0 },
              font: { type: 'string' },
              reverse: { type: 'boolean' },
              align: { type: 'string', enum: ['left', 'center', 'right'] }
            }
          }
        ]
      },
      TemplateElementBarcode: {
        allOf: [
          { $ref: '#/components/schemas/TemplateElementBase' },
          {
            type: 'object',
            required: ['type', 'content', 'barcodeType', 'heightPct'],
            properties: {
              type: { const: 'barcode' },
              content: { type: 'string' },
              barcodeType: { $ref: '#/components/schemas/BarcodeType' },
              heightPct: { type: 'number', minimum: 1, maximum: 100, description: 'Barcode height as a percentage of label height' },
              narrowBarWidth: { type: 'integer', minimum: 1, maximum: 10 },
              humanReadable: { type: 'boolean' }
            }
          }
        ]
      },
      TemplateElementQr: {
        allOf: [
          { $ref: '#/components/schemas/TemplateElementBase' },
          {
            type: 'object',
            required: ['type', 'content', 'magnification'],
            properties: {
              type: { const: 'qrcode' },
              content: { type: 'string' },
              magnification: { type: 'integer', minimum: 1, maximum: 10 },
              errorCorrection: { type: 'string', enum: ['L', 'M', 'Q', 'H'] }
            }
          }
        ]
      },
      TemplateElementBox: {
        allOf: [
          { $ref: '#/components/schemas/TemplateElementBase' },
          {
            type: 'object',
            required: ['type', 'widthPct', 'heightPct', 'thickness'],
            properties: {
              type: { const: 'box' },
              widthPct: { type: 'number', minimum: 0.1, maximum: 150 },
              heightPct: { type: 'number', minimum: 0.1, maximum: 150 },
              thickness: { type: 'integer', minimum: 1, maximum: 100, description: 'Border/line thickness in dots' },
              rounding: { type: 'integer', minimum: 0, maximum: 8 },
              fill: { type: 'boolean' }
            }
          }
        ]
      },
      TemplateElement: {
        oneOf: [
          { $ref: '#/components/schemas/TemplateElementText' },
          { $ref: '#/components/schemas/TemplateElementBarcode' },
          { $ref: '#/components/schemas/TemplateElementQr' },
          { $ref: '#/components/schemas/TemplateElementBox' }
        ]
      },
      TemplateDefinition: {
        type: 'object',
        required: ['name', 'baseWidthDots', 'baseHeightDots'],
        properties: {
          name: { type: 'string', maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
          baseWidthDots: { type: 'integer', minimum: 1, description: 'Reference design width in dots' },
          baseHeightDots: { type: 'integer', minimum: 1, description: 'Reference design height in dots' },
          variables: {
            type: 'array',
            items: { $ref: '#/components/schemas/TemplateVariable' }
          },
          elements: {
            type: 'array',
            items: { $ref: '#/components/schemas/TemplateElement' }
          },
          overrides: {
            type: 'object',
            description: 'Per-size overrides: sizeKey ("{widthDots}x{heightDots}") → elementId → partial element fields.',
            additionalProperties: {
              type: 'object',
              additionalProperties: { type: 'object', additionalProperties: true }
            }
          }
        }
      },
      StoredTemplate: {
        allOf: [
          { $ref: '#/components/schemas/TemplateDefinition' },
          {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', example: 'tpl_1d1d3c01b1942eaf' },
              createdAt: { type: 'string' },
              updatedAt: { type: 'string' }
            }
          }
        ]
      },

      // ── Jobs ───────────────────────────────────────────────────────────
      JobStatus: {
        type: 'string',
        enum: ['pending', 'printing', 'completed', 'failed', 'cancelled']
      },
      JobType: {
        type: 'string',
        enum: ['text', 'barcode', 'qr', 'zpl', 'label']
      },
      LogLevel: {
        type: 'string',
        enum: ['debug', 'info', 'warn', 'error']
      },
      PrintJob: {
        type: 'object',
        description: 'A persisted print job. Field names are snake_case for backward compatibility.',
        properties: {
          id: { type: 'string', example: 'job_1712345678901_ab12cd' },
          status: { $ref: '#/components/schemas/JobStatus' },
          job_type: { $ref: '#/components/schemas/JobType' },
          request_data: { type: 'string', description: 'Original request body as a JSON string' },
          zpl_commands: { type: ['string', 'null'], description: 'Generated ZPL (null until processed)' },
          printer_name: { type: ['string', 'null'] },
          cups_job_id: { type: ['string', 'null'] },
          error_message: { type: ['string', 'null'] },
          created_at: { type: 'string' },
          started_at: { type: ['string', 'null'] },
          completed_at: { type: ['string', 'null'] },
          priority: { type: 'integer' }
        }
      },
      JobLogEntry: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          job_id: { type: 'string' },
          level: { $ref: '#/components/schemas/LogLevel' },
          message: { type: 'string' },
          created_at: { type: 'string' }
        }
      },
      JobStats: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          pending: { type: 'integer' },
          printing: { type: 'integer' },
          completed: { type: 'integer' },
          failed: { type: 'integer' },
          cancelled: { type: 'integer' }
        }
      },

      // ── Settings & sizing ───────────────────────────────────────────────
      LabelSize: {
        type: 'object',
        properties: {
          widthInches: { type: 'number', example: 2 },
          heightInches: { type: 'number', example: 1 },
          widthDots: { type: 'integer', example: 406 },
          heightDots: { type: 'integer', example: 203 },
          name: { type: 'string', example: '2×1" (small)' }
        }
      },

      // ── Updates ─────────────────────────────────────────────────────────
      VersionInfo: {
        type: 'object',
        properties: {
          current: { type: 'string', example: '0.1.1' },
          latest: { type: ['string', 'null'], example: '0.1.2' },
          updateAvailable: { type: 'boolean' },
          checkedAt: { type: ['string', 'null'] },
          error: { type: ['string', 'null'] },
          releaseUrl: { type: ['string', 'null'] }
        }
      }
    },
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
      },
      TemplateResponse: {
        description: 'A label template',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                template: { $ref: '#/components/schemas/StoredTemplate' }
              }
            }
          }
        }
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string', example: 'Template not found' }
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
    { name: 'System', description: 'Health, diagnostics, and API docs' },
    { name: 'Discovery', description: 'Printer discovery' },
    { name: 'Printing', description: 'Label printing endpoints' },
    { name: 'Rendering', description: 'Build ZPL without printing (for previews)' },
    { name: 'Templates', description: 'Reusable, auto-scaling label templates' },
    { name: 'Jobs', description: 'Print queue and job management' },
    { name: 'Settings', description: 'Server settings and label sizing' },
    { name: 'Maintenance', description: 'Version checks and self-update' }
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
