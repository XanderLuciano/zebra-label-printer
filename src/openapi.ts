/**
 * OpenAPI 3.1 specification for the Zebra Label Printer API.
 *
 * Served at GET /api/docs/openapi.json and rendered via Swagger UI at GET /api/docs.
 *
 * **Request bodies are generated, not written here.** Every `*Request` schema in
 * `components.schemas` comes from the Zod schema that validates it, via
 * `./openapi-zod`, so a limit or enum cannot be documented differently from what
 * the server enforces. Field prose for those lives in `.describe()` in `./schemas`.
 *
 * Still hand-written: paths, endpoint prose, examples, and response schemas —
 * nothing validates a response, so there is no definition to generate from.
 * `test/unit/openapi-drift.test.ts` guards whatever remains duplicated.
 */

import { generateRequestSchemas } from './openapi-zod'
import { CURRENT_VERSION } from './updater'

/** Generated once at module load, not per request. */
const GENERATED_REQUEST_SCHEMAS = generateRequestSchemas()

export const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Zebra Label Printer API',
    version: CURRENT_VERSION,
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
          'Configured printers, each with its own media configuration and live health, plus ' +
          'the CUPS queues that are visible but not configured yet. ' +
          'Browser-attached (WebUSB) printers are not listed here: that pairing ' +
          'belongs to a single browser, so those profiles are stored client-side.\n\n' +
          'Each printer is checked against the devices CUPS can actually see, so a printer ' +
          'whose USB cable has been pulled reports `health: "unplugged"` even though its queue ' +
          'still claims to be idle — CUPS only notices a missing device when it tries to print.',
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
              schema: { $ref: '#/components/schemas/PrinterCreateRequest' },
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
              schema: { $ref: '#/components/schemas/PrinterUpdateRequest' },
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
              schema: { $ref: '#/components/schemas/TextLabelRequest' },
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
              schema: { $ref: '#/components/schemas/BarcodeLabelRequest' },
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
              schema: { $ref: '#/components/schemas/QRLabelRequest' }
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
            // Raw ZPL, passed through verbatim. Any body that doesn't start with
            // `{` or `[` takes this path regardless of the declared content type.
            'text/plain': {
              schema: { type: 'string', minLength: 1, example: '^XA^FO20,20^A0N,30,30^FDHello^FS^XZ' }
            },
            // The union also accepts a bare JSON string, which is why this isn't
            // just the object form.
            'application/json': {
              schema: { $ref: '#/components/schemas/ZplRequest' }
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
              schema: { $ref: '#/components/schemas/LabelRequest' },
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
              schema: { $ref: '#/components/schemas/RenderZplRequest' }
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
        description:
          'Returns the user\'s own templates first, followed by the built-in ' +
          'presets. Presets are served from code rather than the database: they ' +
          'carry `readOnly: true`, have no timestamps, and cannot be edited or ' +
          'deleted — save a copy to customise one.',
        responses: {
          '200': {
            description: 'User templates and built-in presets',
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
        description: 'Resolves user templates and built-in presets alike.',
        responses: {
          '200': { $ref: '#/components/responses/TemplateResponse' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      },
      put: {
        summary: 'Update a label template',
        operationId: 'updateTemplate',
        tags: ['Templates'],
        description:
          'Only the user\'s own templates can be updated. Built-in presets are ' +
          'read-only; save a copy instead.',
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
          '403': { $ref: '#/components/responses/PresetImmutable' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      },
      delete: {
        summary: 'Delete a label template',
        operationId: 'deleteTemplate',
        tags: ['Templates'],
        description:
          'Only the user\'s own templates can be deleted. Built-in presets are ' +
          'read-only and cannot be removed.',
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
          '403': { $ref: '#/components/responses/PresetImmutable' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      }
    },
    '/api/templates/{shortName}/schema': {
      parameters: [
        {
          name: 'shortName',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          example: 'part-2x1',
          description: 'Template short name. Matched case-insensitively.'
        }
      ],
      get: {
        summary: 'Describe a template\'s variables',
        operationId: 'getTemplatePrintSchema',
        tags: ['Templates'],
        description:
          'What a template takes, for building a print request without opening the ' +
          'designer. Deliberately not the full definition: exposing the layout would ' +
          'invite callers to depend on it, which is the coupling short names exist to ' +
          'avoid. `required` marks the variables the layout actually references — a ' +
          'variable that is declared but never used in an element is optional.',
        responses: {
          '200': {
            description: 'The template\'s print contract',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    template: { $ref: '#/components/schemas/TemplateRef' },
                    description: { type: 'string', nullable: true },
                    readOnly: { type: 'boolean', description: 'True for built-in presets' },
                    labelSize: {
                      type: 'object',
                      description: 'The size the template was designed at, not necessarily the size it will print at.',
                      properties: {
                        widthDots: { type: 'integer' },
                        heightDots: { type: 'integer' }
                      }
                    },
                    variables: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', example: 'partNumber' },
                          label: { type: 'string', example: 'Part number' },
                          sample: {
                            type: 'string',
                            description: 'Example value from the designer. Never substituted on a real print.'
                          },
                          required: { type: 'boolean' }
                        }
                      }
                    },
                    endpoint: {
                      type: 'object',
                      properties: {
                        method: { const: 'POST' },
                        path: { type: 'string', example: '/api/print/template/part-2x1' }
                      }
                    }
                  }
                }
              }
            }
          },
          '404': { $ref: '#/components/responses/TemplateNotFound' }
        }
      }
    },
    '/api/print/template/{shortName}': {
      parameters: [
        {
          name: 'shortName',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          example: 'part-2x1',
          description: 'Template short name. Matched case-insensitively.'
        }
      ],
      post: {
        summary: 'Print a template by short name (webhook)',
        operationId: 'printTemplate',
        tags: ['Printing'],
        description:
          'Print a saved template from a JSON payload of its variables. Designed to be ' +
          'called by other services and from browser JavaScript: the caller needs only ' +
          'a short name and the variable names, so a template can be redesigned without ' +
          'breaking any integration pointed at it.\n\n' +
          '**Variables** may be sent nested under `variables` (canonical) or flat at the ' +
          'top level, where any key that is not a control field is read as a variable. ' +
          'Unknown variable names are rejected rather than ignored, so a typo is an ' +
          'error rather than a blank field on a physical label. Variables the layout ' +
          'references must all be supplied unless `allowMissingVariables` is set; a ' +
          'variable\'s sample value is never substituted on a real print.\n\n' +
          '**Label size** comes from the target printer\'s saved configuration, not the ' +
          'template\'s design size, and the layout is scaled to fit. When they differ and ' +
          'the template has no override for the target size, a `LABEL_SIZE_MISMATCH` ' +
          'warning is returned alongside the success.\n\n' +
          '**CORS** is open by default; set `ZEBRA_CORS_ORIGINS` to restrict it. This ' +
          'endpoint is rate limited per client address — see `ZEBRA_PRINT_RATE_LIMIT`. ' +
          'On an install with no `ZEBRA_API_KEY` it is unauthenticated, which means any ' +
          'page the operator visits can consume label stock; set an API key on anything ' +
          'reachable from a network you do not control.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TemplatePrintRequest' },
              examples: {
                nested: {
                  summary: 'Canonical: variables nested, three copies',
                  value: {
                    variables: { partNumber: '135853-002', partName: 'Lens Mount', rev: 'C', vendor: 'NRG', ticket: 'PI-1042', serial: 'NRG-001' },
                    quantity: 3
                  }
                },
                flat: {
                  summary: 'Flat: for services with a fixed payload shape',
                  value: {
                    partNumber: '135853-002', partName: 'Lens Mount', rev: 'C',
                    vendor: 'NRG', ticket: 'PI-1042', serial: 'NRG-001', quantity: 3
                  }
                },
                targeted: {
                  summary: 'Named printer',
                  value: { variables: { assetId: 'NRG-001' }, printerId: 'prt_a1b2c3' }
                },
                dryRun: {
                  summary: 'Render only — nothing prints, no job recorded',
                  value: { variables: { partNumber: '135853-002' }, allowMissingVariables: true, dryRun: true }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Printed, queued, or (for dryRun) rendered',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/TemplatePrintResult' },
                    { $ref: '#/components/schemas/TemplateDryRunResult' }
                  ]
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/TemplatePrintBadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/TemplateNotFound' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/PrintFailed' },
          '503': { $ref: '#/components/responses/PrinterUnavailable' }
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
              schema: { $ref: '#/components/schemas/SerialLabelRequest' }
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
              schema: { $ref: '#/components/schemas/ClearJobsRequest' }
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
              schema: { $ref: '#/components/schemas/ClearJobsRequest' }
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
              schema: { $ref: '#/components/schemas/JobResultRequest' },
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
              schema: { $ref: '#/components/schemas/PrinterConfigRequest' },
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
              schema: { $ref: '#/components/schemas/PrinterCalibrateRequest' }
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
              schema: { $ref: '#/components/schemas/SettingsRequest' },
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
              schema: { $ref: '#/components/schemas/LabelSizeRequest' },
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
                          pending: { type: 'integer' },
                          health: { $ref: '#/components/schemas/PrinterHealth' },
                          presence: { $ref: '#/components/schemas/DevicePresence' },
                          healthChangedAt: {
                            type: ['string', 'null'],
                            description: 'When the health monitor last saw this printer change state.'
                          }
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
      // Request bodies, generated from the Zod schemas that validate them. Listed
      // first so a hand-written entry below with the same name is an obvious
      // override rather than a silent shadow.
      ...GENERATED_REQUEST_SCHEMAS,
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
      TemplateRef: {
        type: 'object',
        description: 'Which template a print used. Echoed in the response and recorded on the job.',
        properties: {
          id: { type: 'string', example: 'tpl_builtin_part_2x1' },
          shortName: { type: 'string', nullable: true, example: 'part-2x1' },
          name: { type: 'string', example: 'Part Label 2x1' }
        }
      },
      PrintWarning: {
        type: 'object',
        description: 'A non-fatal observation about a print. Always present, empty when there is nothing to report.',
        properties: {
          code: { type: 'string', example: 'LABEL_SIZE_MISMATCH' },
          message: { type: 'string' }
        }
      },
      TemplatePrintResult: {
        type: 'object',
        description:
          'Same shape as the other print endpoints, plus the template context. ' +
          '`queued: true` is not a failure — the printer was unreachable and the job is ' +
          'persisted for the background processor. Poll GET /api/jobs/{jobId} to find out ' +
          'whether a label physically came out.',
        properties: {
          success: { const: true },
          jobId: { type: 'string', example: 'job_1788561359824_u1fnd9' },
          queued: { type: 'boolean' },
          target: { type: 'string', enum: ['server', 'local'] },
          printerId: { type: 'string', nullable: true },
          labelSize: {
            type: 'object',
            properties: {
              widthDots: { type: 'integer' },
              heightDots: { type: 'integer' },
              dpi: { type: 'integer' }
            }
          },
          zpl: {
            type: 'string',
            description: 'Present only for a local (WebUSB) target. Send it to the printer, then report back via POST /api/jobs/{jobId}/result.'
          },
          quantity: { type: 'integer' },
          template: { $ref: '#/components/schemas/TemplateRef' },
          warnings: { type: 'array', items: { $ref: '#/components/schemas/PrintWarning' } }
        }
      },
      TemplateDryRunResult: {
        type: 'object',
        description: 'Returned when `dryRun` is set. Nothing printed, no job recorded.',
        properties: {
          success: { const: true },
          dryRun: { const: true },
          zpl: { type: 'string' },
          elements: { type: 'array', items: { $ref: '#/components/schemas/LabelElement' } },
          labelSize: {
            type: 'object',
            properties: {
              widthDots: { type: 'integer' },
              heightDots: { type: 'integer' },
              dpi: { type: 'integer' }
            }
          },
          quantity: { type: 'integer' },
          template: { $ref: '#/components/schemas/TemplateRef' },
          warnings: { type: 'array', items: { $ref: '#/components/schemas/PrintWarning' } }
        }
      },
      ApiError: {
        type: 'object',
        description:
          'The failure envelope. `error` is a human-readable string and has always been ' +
          'present; `code` was added for integrations to branch on and is the part that is ' +
          'stable. `error` and `message` may be reworded in any release. Treat an ' +
          'unrecognised `code` as a generic failure of its HTTP status class.',
        required: ['error', 'code'],
        properties: {
          error: { type: 'string' },
          code: {
            type: 'string',
            enum: [
              'INVALID_JSON', 'VALIDATION_FAILED', 'UNKNOWN_VARIABLES', 'MISSING_VARIABLES',
              'RENDER_FAILED', 'BAD_REQUEST', 'UNAUTHORIZED', 'PRESET_IMMUTABLE',
              'TEMPLATE_NOT_FOUND', 'PRINTER_NOT_FOUND', 'NOT_FOUND', 'SHORT_NAME_TAKEN',
              'RATE_LIMITED', 'PRINT_FAILED', 'INTERNAL_ERROR', 'NO_PRINTER', 'QUEUE_UNAVAILABLE'
            ]
          },
          message: { type: 'string', description: 'Longer explanation, when there is more to say than `error`.' },
          details: {
            type: 'array',
            description: 'Per-field problems. Present for validation failures.',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string', description: 'Dotted path, or "(root)" for the body itself.' },
                message: { type: 'string' },
                code: { type: 'string', description: 'Zod\'s own issue code, e.g. "too_big".' }
              }
            }
          }
        }
      },
      StoredTemplate: {
        allOf: [
          { $ref: '#/components/schemas/TemplateDefinition' },
          {
            type: 'object',
            required: ['id', 'readOnly'],
            properties: {
              id: { type: 'string', example: 'tpl_1d1d3c01b1942eaf' },
              readOnly: {
                type: 'boolean',
                description:
                  'True for built-in presets, which are served from code and cannot be edited or deleted. ' +
                  'False for the user\'s own templates.'
              },
              createdAt: { type: 'string', description: 'Absent on built-in presets, which are never stored.' },
              updatedAt: { type: 'string', description: 'Absent on built-in presets, which are never stored.' }
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
      DevicePresence: {
        type: 'string',
        enum: ['present', 'absent', 'unknown'],
        description:
          'Whether the printer is physically attached. Reported separately from `status` ' +
          'because CUPS does not watch USB: a queue can be idle and accepting with the cable ' +
          'unplugged. "unknown" means the question cannot be answered — a networked printer, ' +
          'or a host where CUPS cannot enumerate devices — and must not be shown as unplugged.'
      },
      PrinterHealth: {
        type: 'string',
        enum: ['ready', 'unplugged', 'offline', 'missing', 'unknown'],
        description:
          'The single verdict to render, combining queue state with device presence. ' +
          '"unplugged" (the device is gone) and "offline" (attached, but CUPS stopped the queue) ' +
          'are deliberately distinct, because the fixes differ.'
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
              accepting: { type: 'boolean', description: 'Whether CUPS is accepting jobs for it.' },
              presence: { $ref: '#/components/schemas/DevicePresence' },
              health: { $ref: '#/components/schemas/PrinterHealth' },
              healthMessage: { type: 'string', description: 'Human-readable explanation of `health`.' }
            }
          }
        ]
      },
      DiscoveredPrinter: {
        type: 'object',
        description: 'A printer CUPS reports, before it has been configured.',
        properties: {
          name: { type: 'string', example: 'ZTC-GK420d' },
          uri: { type: 'string', description: 'Device URI, e.g. `usb://Zebra/ZTC%20GK420d?serial=38J1542`.' },
          model: { type: 'string' },
          status: { type: 'string', enum: ['idle', 'printing', 'unavailable', 'unknown'] },
          accepting: { type: 'boolean' },
          serial: { type: 'string' },
          isZebra: { type: 'boolean' },
          presence: { $ref: '#/components/schemas/DevicePresence' }
        }
      },

      // ── Updates ─────────────────────────────────────────────────────────
      VersionInfo: {
        type: 'object',
        properties: {
          current: { type: 'string', example: '0.4.0' },
          latest: { type: ['string', 'null'], example: '0.4.1' },
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
      },
      TemplateNotFound: {
        description: 'No template with that short name',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              error: 'Template not found',
              code: 'TEMPLATE_NOT_FOUND',
              message: 'No template has the short name \'part-2x2\'. Short names are set in the template designer; GET /api/templates lists them.',
              shortName: 'part-2x2'
            }
          }
        }
      },
      TemplatePrintBadRequest: {
        description: 'The body failed validation, or the variables do not match the template',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            examples: {
              unknownVariables: {
                summary: 'A variable the template does not declare — often a typo',
                value: {
                  error: 'Unknown variable: partNumbr',
                  code: 'UNKNOWN_VARIABLES',
                  message: 'This template accepts: partName, partNumber, rev, vendor, ticket, serial.',
                  details: [{ field: 'variables.partNumbr', message: 'Not a variable of this template' }],
                  accepts: ['partName', 'partNumber', 'rev', 'vendor', 'ticket', 'serial'],
                  unknown: ['partNumbr']
                }
              },
              missingVariables: {
                summary: 'A variable the layout references was not supplied',
                value: {
                  error: 'Missing required variables: rev, vendor',
                  code: 'MISSING_VARIABLES',
                  message: 'Every variable the template\'s layout references needs a value. Send `allowMissingVariables: true` to print them blank instead.',
                  missing: ['rev', 'vendor']
                }
              },
              validationFailed: {
                summary: 'The body itself is wrong',
                value: {
                  error: 'Validation failed',
                  code: 'VALIDATION_FAILED',
                  message: 'quantity: Too many copies — the maximum is 500 per request',
                  details: [{ field: 'quantity', message: 'Too many copies — the maximum is 500 per request', code: 'too_big' }]
                }
              }
            }
          }
        }
      },
      Unauthorized: {
        description: 'An API key is configured and was not supplied, or is wrong',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              error: 'Unauthorized — provide a valid API key via Bearer auth or ?key= query param',
              code: 'UNAUTHORIZED'
            }
          }
        }
      },
      RateLimited: {
        description: 'Too many print requests from this client. See the Retry-After header.',
        headers: {
          'Retry-After': { schema: { type: 'integer' }, description: 'Seconds until the window resets' },
          'X-RateLimit-Limit': { schema: { type: 'integer' } },
          'X-RateLimit-Remaining': { schema: { type: 'integer' } }
        },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              error: 'Too many print requests',
              code: 'RATE_LIMITED',
              message: 'This endpoint accepts 120 requests per minute. Retry in 34s.',
              retryAfterSeconds: 34
            }
          }
        }
      },
      PrintFailed: {
        description: 'The printer accepted the job and reported a failure. Check the job before retrying — a label may have come out.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: {
              error: 'lp: unable to print file',
              code: 'PRINT_FAILED',
              success: false,
              jobId: 'job_1788561359824_u1fnd9'
            }
          }
        }
      },
      PresetImmutable: {
        description: 'The id names a built-in preset, which is read-only',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: {
                  type: 'string',
                  example:
                    'This template is a built-in preset and cannot be changed or removed. ' +
                    'Save a copy to customise it — the copy is yours to edit.'
                }
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
