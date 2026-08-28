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
        summary: 'List configured printers',
        operationId: 'listPrinters',
        tags: ['Printers'],
        description:
          'Configured printers, each with its own media configuration, plus the ' +
          'CUPS queues that are visible but not configured yet. ' +
          'Browser-attached (WebUSB) printers are not listed here: that pairing ' +
          'belongs to a single browser, so those profiles are stored client-side.',
        responses: {
          '200': {
            description: 'Configured printers and unconfigured candidates',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    printers: {
                      type: 'array',
                      description: 'Configured printers, default first.',
                      items: { $ref: '#/components/schemas/PrinterProfileStatus' }
                    },
                    discovered: {
                      type: 'array',
                      description: 'CUPS queues that are not configured yet — candidates to add.',
                      items: { $ref: '#/components/schemas/DiscoveredPrinter' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        summary: 'Configure a printer',
        operationId: 'createPrinter',
        tags: ['Printers'],
        description:
          'Register a printer this server can drive. Media configuration is optional — ' +
          'anything omitted is seeded from the current defaults, so adopting a discovered ' +
          'printer needs little more than its CUPS queue name.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PrinterProfileInput' },
              examples: {
                adopt: {
                  summary: 'Adopt a discovered CUPS printer',
                  value: { name: 'Warehouse GK420d', cupsName: 'ZTC-GK420d' }
                },
                configured: {
                  summary: 'Register with its own label stock',
                  value: {
                    name: 'Bench 2×1',
                    cupsName: 'ZTC-GK420d-2',
                    labelSize: { widthDots: 406, heightDots: 203, name: '2×1" (small)' },
                    tracking: 'gap',
                    isDefault: true
                  }
                }
              }
            }
          }
        },
        responses: {
          '201': { $ref: '#/components/responses/PrinterResponse' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '409': {
            description: 'That CUPS queue is already configured',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { error: { type: 'string' } } }
              }
            }
          }
        }
      }
    },
    '/api/printers/discovered': {
      get: {
        summary: 'List printers CUPS can see',
        operationId: 'listDiscoveredPrinters',
        tags: ['Printers'],
        description:
          'Raw discovery view, configured or not. Returns an empty list rather than an ' +
          'error when CUPS is unavailable.',
        responses: {
          '200': {
            description: 'Discovered printers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    printers: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/DiscoveredPrinter' }
                    },
                    error: { type: 'string', description: 'Why discovery came back empty, if it did.' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/printers/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
      ],
      get: {
        summary: 'Get a configured printer',
        operationId: 'getPrinter',
        tags: ['Printers'],
        responses: {
          '200': { $ref: '#/components/responses/PrinterResponse' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      },
      put: {
        summary: 'Update a printer',
        operationId: 'updatePrinter',
        tags: ['Printers'],
        description:
          "Update any subset of a printer's identity or media configuration. " +
          'Changing `dpi` alone re-derives the label size in inches, since the same ' +
          'dot dimensions describe a different physical label at a different resolution.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PrinterProfileInput' },
              examples: {
                labelStock: {
                  summary: 'Load different label stock on this printer',
                  value: { labelSize: { widthDots: 812, heightDots: 1218, name: '4×6" (shipping)' } }
                },
                rename: { summary: 'Rename', value: { name: 'Shipping desk' } }
              }
            }
          }
        },
        responses: {
          '200': { $ref: '#/components/responses/PrinterResponse' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      },
      delete: {
        summary: 'Remove a printer',
        operationId: 'deletePrinter',
        tags: ['Printers'],
        description:
          'Stops managing the printer. Its print history is kept — jobs record the ' +
          'printer id as a plain string, so removing a printer never deletes what it printed.',
        responses: {
          '200': {
            description: 'Printer removed',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { success: { type: 'boolean' } } }
              }
            }
          },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      }
    },
    '/api/printers/{id}/default': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
      ],
      post: {
        summary: 'Make this the default printer',
        operationId: 'setDefaultPrinter',
        tags: ['Printers'],
        description: 'Used for any print request that does not name a printer.',
        responses: {
          '200': { $ref: '#/components/responses/PrinterResponse' },
          '404': { $ref: '#/components/responses/NotFound' }
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
                  },
                  target: { $ref: '#/components/schemas/PrintTarget' },
                  printerId: { $ref: '#/components/schemas/PrinterId' },
                  printerName: {
                    type: 'string',
                    description: 'Name to record on the job. Only needed for a printer this server cannot name itself — i.e. a browser-attached one.'
                  },
                  labelSize: { $ref: '#/components/schemas/LabelGeometry' }
                }
              },
              examples: {
                simple: {
                  summary: 'Simple label',
                  value: { lines: ['Kitchen Utensils'] }
                },
                localUsb: {
                  summary: 'Record the job and return ZPL for local USB printing',
                  value: { lines: ['Kitchen Utensils'], target: 'local' }
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
                  },
                  target: { $ref: '#/components/schemas/PrintTarget' },
                  printerId: { $ref: '#/components/schemas/PrinterId' },
                  printerName: {
                    type: 'string',
                    description: 'Name to record on the job. Only needed for a printer this server cannot name itself — i.e. a browser-attached one.'
                  },
                  labelSize: { $ref: '#/components/schemas/LabelGeometry' }
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
                  },
                  target: { $ref: '#/components/schemas/PrintTarget' },
                  printerId: { $ref: '#/components/schemas/PrinterId' },
                  printerName: {
                    type: 'string',
                    description: 'Name to record on the job. Only needed for a printer this server cannot name itself — i.e. a browser-attached one.'
                  },
                  labelSize: { $ref: '#/components/schemas/LabelGeometry' }
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
                properties: {
                  zpl: { type: 'string' },
                  target: { $ref: '#/components/schemas/PrintTarget' },
                  printerId: { $ref: '#/components/schemas/PrinterId' },
                  printerName: {
                    type: 'string',
                    description: 'Name to record on the job. Only needed for a printer this server cannot name itself — i.e. a browser-attached one.'
                  },
                  labelSize: { $ref: '#/components/schemas/LabelGeometry' }
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
                  copies: { type: 'integer', minimum: 1, maximum: 10 },
                  target: { $ref: '#/components/schemas/PrintTarget' },
                  printerId: { $ref: '#/components/schemas/PrinterId' },
                  printerName: {
                    type: 'string',
                    description: 'Name to record on the job. Only needed for a printer this server cannot name itself — i.e. a browser-attached one.'
                  },
                  labelSize: { $ref: '#/components/schemas/LabelGeometry' }
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
                  printerId: { $ref: '#/components/schemas/PrinterId' },
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
                    printerId: { type: ['string', 'null'] },
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
          { name: 'printerId', in: 'query', required: false, schema: { type: 'string' }, description: 'Only jobs routed to this printer' },
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
    '/api/jobs/{id}/result': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Job id' }
      ],
      post: {
        summary: 'Report the outcome of a locally printed job',
        operationId: 'reportJobResult',
        tags: ['Jobs'],
        description: 'Called after a job requested with `target: "local"` has been transmitted by the caller. Without this the job stays in the "printing" state indefinitely.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success'],
                properties: {
                  success: { type: 'boolean' },
                  error: { type: 'string', maxLength: 500, description: 'Failure detail, recorded on the job' }
                }
              },
              examples: {
                ok: { summary: 'Transfer succeeded', value: { success: true } },
                failed: { summary: 'Transfer failed', value: { success: false, error: 'USB transfer failed (stall)' } }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Job finalized',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { const: true },
                    jobId: { type: 'string' },
                    status: { type: 'string', enum: ['completed', 'failed'] }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { description: 'Job not found' },
          '503': { description: 'Job queue unavailable' }
        }
      }
    },
    '/api/printer/configure': {
      post: {
        summary: 'Apply media geometry to the printer',
        operationId: 'configurePrinter',
        tags: ['Printer'],
        description: [
          'Sends the media configuration to the printer: `^PW` (print width), `^ML` (maximum label length, set an inch past the label so the gap search can reach the next gap), `^MN` (media tracking) and `^LH0,0`. Saved to non-volatile memory with `^JUS` unless `persist: false`.',
          '',
          '`^LL` is only sent for `continuous` tracking. Zebra documents it as ignored on non-continuous gap/mark media, where the real label length comes from the gap sensor during calibration.',
          '',
          'Acts on one printer. Omitted dimensions fall back to *that printer\'s* saved configuration, so `{ "printerId": "..." }` means "make this printer match what it is configured for" — which is what you want after swapping label stock or moving the printer to a different machine.',
          '',
          'Needed because changing a label size only affects the ZPL this app generates; the printer keeps its own stored print width and media settings until told otherwise.'
        ].join('\n'),
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  printerId: { $ref: '#/components/schemas/PrinterId' },
                  widthDots: { type: 'integer', minimum: 100, maximum: 2400 },
                  heightDots: { type: 'integer', minimum: 50, maximum: 7967 },
                  dpi: { type: 'integer', enum: [203, 300, 600], default: 203 },
                  tracking: { $ref: '#/components/schemas/MediaTracking' },
                  markOffset: {
                    type: 'integer',
                    minimum: -240,
                    maximum: 566,
                    description: 'Black mark offset in dots. Only used when tracking is "mark".'
                  },
                  persist: { type: 'boolean', default: true, description: 'Save to the printer\'s non-volatile memory (^JUS)' },
                  calibrate: { type: 'boolean', default: false, description: 'Run a sensor calibration (~JC) straight after applying. Feeds 2-4 labels.' },
                  target: { $ref: '#/components/schemas/PrintTarget' }
                }
              },
              examples: {
                current: { summary: 'Apply the configured label size', value: {} },
                dieCut: {
                  summary: '2x1" die-cut labels, then calibrate',
                  value: { widthDots: 406, heightDots: 203, tracking: 'gap', calibrate: true }
                },
                continuous: {
                  summary: 'Continuous roll (label length comes from ^LL)',
                  value: { widthDots: 406, heightDots: 203, tracking: 'continuous' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Configuration applied, or returned as ZPL when target is "local"',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    target: { $ref: '#/components/schemas/PrintTarget' },
                    zpl: { type: 'string', description: 'Present only when target is "local"' },
                    error: { type: 'string' },
                    applied: {
                      type: 'object',
                      properties: {
                        printerId: { type: ['string', 'null'] },
                        widthDots: { type: 'integer' },
                        heightDots: { type: 'integer' },
                        dpi: { type: 'integer' },
                        tracking: { $ref: '#/components/schemas/MediaTracking' },
                        calibrated: { type: 'boolean' }
                      }
                    }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '500': { description: 'The printer rejected the configuration' },
          '503': { description: 'No printer connected' }
        }
      }
    },
    '/api/printer/calibrate': {
      post: {
        summary: 'Run a media sensor calibration',
        operationId: 'calibratePrinter',
        tags: ['Printer'],
        description: 'Sends `~JC`. The printer feeds 2-4 labels while measuring gap/mark sensor thresholds and the actual label length; this is what removes cumulative vertical drift after a media change. Apply the media configuration first so calibration knows the media type and search window.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  printerId: { $ref: '#/components/schemas/PrinterId' },
                  target: { $ref: '#/components/schemas/PrintTarget' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Calibration started, or returned as ZPL when target is "local"',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    target: { $ref: '#/components/schemas/PrintTarget' },
                    zpl: { type: 'string', description: 'Present only when target is "local"' },
                    message: { type: 'string' },
                    error: { type: 'string' }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '500': { description: 'The printer rejected the calibration command' },
          '503': { description: 'No printer connected' }
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
        description: 'Saves the label size and also pushes the geometry to the connected printer (see POST /api/printer/configure). Saving the setting alone would only change the ZPL we generate — the printer keeps its own stored print width and media settings, which is how a size change ends up producing clipped or drifting labels. Pass `applyToPrinter: false` to skip that, for example when the browser owns the printer over WebUSB.',
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
                  name: { type: 'string' },
                  applyToPrinter: { type: 'boolean', default: true, description: 'Push the geometry to the connected printer' },
                  tracking: { $ref: '#/components/schemas/MediaTracking' }
                }
              },
              examples: {
                standard: { summary: '2x1" labels', value: { widthDots: 406, heightDots: 203, name: '2x1"' } },
                settingOnly: {
                  summary: 'Save without touching the printer',
                  value: { widthDots: 406, heightDots: 203, applyToPrinter: false }
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
                    size: { $ref: '#/components/schemas/LabelSize' },
                    printerConfig: {
                      type: 'object',
                      description: 'Whether the geometry reached the printer',
                      properties: {
                        applied: { type: 'boolean' },
                        error: { type: 'string' }
                      }
                    }
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
                      description: 'The default printer. `name` is null when none is configured.',
                      properties: {
                        name: { type: ['string', 'null'] },
                        isReady: { type: 'boolean' }
                      }
                    },
                    printers: {
                      type: 'array',
                      description: 'Every configured printer with its media config and pending job count.',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          transport: { $ref: '#/components/schemas/PrinterTransport' },
                          cupsName: { type: ['string', 'null'] },
                          isDefault: { type: 'boolean' },
                          labelSize: { $ref: '#/components/schemas/LabelSize' },
                          dpi: { type: 'integer' },
                          tracking: { $ref: '#/components/schemas/MediaTracking' },
                          pending: { type: 'integer' }
                        }
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
              errorCorrection: { type: 'string', enum: ['L', 'M', 'Q', 'H'] },
              rotation: { type: 'string', enum: ['N', 'R', 'I', 'B'], default: 'N' }
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
          printer_id: {
            type: ['string', 'null'],
            description:
              'The configured printer this job was routed to. Null on jobs created before ' +
              'printers were configurable. A `local_` prefix means a browser-attached printer.'
          },
          label_width_dots: {
            type: ['integer', 'null'],
            description: 'Label width the job was rendered for, frozen at creation. Null on jobs created before this was recorded.'
          },
          label_height_dots: {
            type: ['integer', 'null'],
            description: 'Label height the job was rendered for, frozen at creation.'
          },
          label_dpi: {
            type: ['integer', 'null'],
            description: 'Print head resolution the job was rendered for.'
          },
          created_at: { type: 'string' },
          started_at: { type: ['string', 'null'] },
          completed_at: { type: ['string', 'null'] },
          priority: { type: 'integer' }
        }
      },
      MediaTracking: {
        type: 'string',
        enum: ['gap', 'mark', 'continuous', 'auto'],
        description: 'How the printer finds the top of each label (ZPL ^MN). "gap" is die-cut stock, "continuous" is an unmarked roll.'
      },
      PrintTarget: {
        type: 'string',
        enum: ['server', 'local'],
        default: 'server',
        description:
          'Where the label is printed. "server" prints via CUPS on the host. "local" records ' +
          'the job and returns the generated ZPL for the caller to transmit itself (used by the ' +
          'browser over WebUSB); report the outcome via POST /api/jobs/{id}/result. ' +
          'This is the coarse choice — prefer `printerId`, which names an actual printer and ' +
          'brings its label geometry with it. A `local_` printer id implies "local" on its own.'
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

      // ── Printers ────────────────────────────────────────────────────────
      PrinterId: {
        type: 'string',
        description:
          'Which configured printer to use. Omit to use the default printer. ' +
          'Ids prefixed `local_` belong to a browser-attached printer: the server ' +
          'cannot print to those, so naming one always returns the ZPL for the caller ' +
          'to transmit, whatever `target` says.',
        example: 'prn_m9x2k1_a7b3c9'
      },
      LabelGeometry: {
        type: 'object',
        description:
          "Label geometry to render for, overriding the printer's saved configuration. " +
          'This is how a browser-attached printer supplies its geometry — its configuration ' +
          'lives in that browser, so the server has nothing to look up. Inches are always ' +
          'derived from dots and DPI server-side and are not accepted here.',
        required: ['widthDots', 'heightDots'],
        properties: {
          widthDots: { type: 'integer', example: 406 },
          heightDots: { type: 'integer', example: 203 },
          dpi: { type: 'integer', enum: [203, 300, 600] },
          name: { type: 'string', example: '2×1" (small)' }
        }
      },
      PrinterTransport: {
        type: 'string',
        enum: ['cups', 'usb', 'tcp'],
        default: 'cups',
        description:
          'How this server reaches the printer. Only `cups` is implemented; `usb` and ' +
          '`tcp` are reserved so profiles created for them round-trip.'
      },
      PrinterProfile: {
        type: 'object',
        description: 'A configured printer and the label stock it is loaded with.',
        properties: {
          id: { type: 'string', example: 'prn_m9x2k1_a7b3c9' },
          name: { type: 'string', example: 'Warehouse GK420d' },
          connection: {
            type: 'string',
            enum: ['server', 'local'],
            description: 'Who drives this printer. Always "server" for printers in this registry.'
          },
          transport: { $ref: '#/components/schemas/PrinterTransport' },
          cupsName: { type: ['string', 'null'], example: 'ZTC-GK420d' },
          deviceUri: { type: ['string', 'null'] },
          usbDeviceId: { type: ['string', 'null'] },
          labelSize: { $ref: '#/components/schemas/LabelSize' },
          dpi: { type: 'integer', enum: [203, 300, 600] },
          tracking: { $ref: '#/components/schemas/MediaTracking' },
          markOffset: { type: 'integer', description: "Black-mark offset in dots; only used when tracking is 'mark'." },
          isDefault: { type: 'boolean', description: 'Used when a print request does not name a printer.' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' }
        }
      },
      PrinterProfileStatus: {
        allOf: [
          { $ref: '#/components/schemas/PrinterProfile' },
          {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['idle', 'printing', 'unavailable', 'unknown'],
                description: 'Live CUPS status. "unknown" when discovery cannot see this queue.'
              },
              accepting: { type: 'boolean', description: 'Whether CUPS is accepting jobs for it.' }
            }
          }
        ]
      },
      PrinterProfileInput: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Warehouse GK420d' },
          transport: { $ref: '#/components/schemas/PrinterTransport' },
          cupsName: {
            type: ['string', 'null'],
            description: 'CUPS queue name. Required when transport is `cups` (the default).',
            example: 'ZTC-GK420d'
          },
          deviceUri: { type: ['string', 'null'] },
          usbDeviceId: { type: ['string', 'null'] },
          labelSize: { $ref: '#/components/schemas/LabelGeometry' },
          dpi: { type: 'integer', enum: [203, 300, 600] },
          tracking: { $ref: '#/components/schemas/MediaTracking' },
          markOffset: { type: ['integer', 'null'], minimum: -240, maximum: 566 },
          isDefault: { type: 'boolean' }
        }
      },
      DiscoveredPrinter: {
        type: 'object',
        description: 'A printer CUPS reports, before it has been configured.',
        properties: {
          name: { type: 'string', example: 'ZTC-GK420d' },
          uri: { type: 'string' },
          model: { type: 'string' },
          status: { type: 'string', enum: ['idle', 'printing', 'unavailable', 'unknown'] },
          accepting: { type: 'boolean' },
          serial: { type: 'string' },
          isZebra: { type: 'boolean' }
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
      PrinterResponse: {
        description: 'The configured printer',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                printer: { $ref: '#/components/schemas/PrinterProfile' }
              }
            }
          }
        }
      },
      PrintSuccess: {
        description: 'Job recorded. Printed via CUPS, queued for retry, or returned as ZPL for the caller to transmit.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', example: true },
                jobId: { type: 'string', example: 'job_1712345678901_ab12cd' },
                queued: { type: 'boolean', description: 'True when the printer was unavailable and the job will be retried' },
                target: { $ref: '#/components/schemas/PrintTarget' },
                zpl: {
                  type: 'string',
                  description: 'Generated ZPL. Present only when `target: "local"` was requested — transmit it yourself, then POST the outcome to /api/jobs/{id}/result.'
                },
                labelSize: {
                  type: 'object',
                  description: 'Label geometry this job was rendered for, also frozen onto the job record.',
                  properties: {
                    widthDots: { type: 'integer' },
                    heightDots: { type: 'integer' },
                    dpi: { type: 'integer' }
                  }
                },
                printerId: {
                  type: ['string', 'null'],
                  description: 'The printer this job was routed to, resolved from the request or the default.'
                },
                error: { type: 'string' }
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
    { name: 'Printers', description: 'Configure printers and their label stock' },
    { name: 'Printing', description: 'Label printing endpoints' },
    { name: 'Rendering', description: 'Build ZPL without printing (for previews)' },
    { name: 'Templates', description: 'Reusable, auto-scaling label templates' },
    { name: 'Jobs', description: 'Print queue and job management' },
    { name: 'Printer', description: 'Media configuration and sensor calibration' },
    { name: 'Settings', description: 'Server settings and legacy global label sizing' },
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
