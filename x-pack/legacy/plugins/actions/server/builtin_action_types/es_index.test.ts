/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

jest.mock('./lib/send_email', () => ({
  sendEmail: jest.fn(),
}));

import { ActionType, ActionTypeExecutorOptions } from '../types';
import { ActionTypeRegistry } from '../action_type_registry';
import { encryptedSavedObjectsMock } from '../../../encrypted_saved_objects/server/plugin.mock';
import { taskManagerMock } from '../../../task_manager/task_manager.mock';
import { validateActionTypeConfig, validateActionTypeParams } from '../lib';
import { SavedObjectsClientMock } from '../../../../../../src/core/server/mocks';
import { registerBuiltInActionTypes } from './index';
import { ActionParamsType, ActionTypeConfigType } from './es_index';

const ACTION_TYPE_ID = '.index';
const NO_OP_FN = () => {};

const services = {
  log: NO_OP_FN,
  callCluster: jest.fn(),
  savedObjectsClient: SavedObjectsClientMock.create(),
};

function getServices() {
  return services;
}

let actionTypeRegistry: ActionTypeRegistry;
let actionType: ActionType;

const mockEncryptedSavedObjectsPlugin = encryptedSavedObjectsMock.create();

beforeAll(() => {
  actionTypeRegistry = new ActionTypeRegistry({
    getServices,
    taskManager: taskManagerMock.create(),
    encryptedSavedObjectsPlugin: mockEncryptedSavedObjectsPlugin,
  });

  registerBuiltInActionTypes(actionTypeRegistry);

  actionType = actionTypeRegistry.get(ACTION_TYPE_ID);
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('action is registered', () => {
  test('gets registered with builtin actions', () => {
    expect(actionTypeRegistry.has(ACTION_TYPE_ID)).toEqual(true);
  });
});

describe('actionTypeRegistry.get() works', () => {
  test('action type static data is as expected', () => {
    expect(actionType.id).toEqual(ACTION_TYPE_ID);
    expect(actionType.name).toEqual('index');
  });
});

describe('config validation', () => {
  test('config validation succeeds when config is valid', () => {
    const config: Record<string, any> = {};

    expect(validateActionTypeConfig(actionType, config)).toEqual({
      ...config,
      index: null,
    });

    config.index = 'testing-123';
    expect(validateActionTypeConfig(actionType, config)).toEqual({
      ...config,
      index: 'testing-123',
    });
  });

  test('config validation fails when config is not valid', () => {
    const baseConfig: Record<string, any> = {
      indeX: 'bob',
    };

    expect(() => {
      validateActionTypeConfig(actionType, baseConfig);
    }).toThrowErrorMatchingInlineSnapshot(
      `"The actionTypeConfig is invalid: [indeX]: definition for this key is missing"`
    );

    delete baseConfig.user;
    baseConfig.index = 666;

    expect(() => {
      validateActionTypeConfig(actionType, baseConfig);
    }).toThrowErrorMatchingInlineSnapshot(`
"The actionTypeConfig is invalid: [index]: types that failed validation:
- [index.0]: expected value of type [string] but got [number]
- [index.1]: expected value to equal [null] but got [666]"
`);
  });
});

describe('params validation', () => {
  test('params validation succeeds when params is valid', () => {
    const params: Record<string, any> = {
      index: 'testing-123',
      executionTimeField: 'field-used-for-time',
      refresh: true,
      documents: [{ rando: 'thing' }],
    };
    expect(validateActionTypeParams(actionType, params)).toMatchInlineSnapshot(`
        Object {
          "documents": Array [
            Object {
              "rando": "thing",
            },
          ],
          "executionTimeField": "field-used-for-time",
          "index": "testing-123",
          "refresh": true,
        }
    `);

    delete params.index;
    delete params.refresh;
    delete params.executionTimeField;
    expect(validateActionTypeParams(actionType, params)).toMatchInlineSnapshot(`
        Object {
          "documents": Array [
            Object {
              "rando": "thing",
            },
          ],
        }
    `);
  });

  test('params validation fails when params is not valid', () => {
    expect(() => {
      validateActionTypeParams(actionType, { documents: [{}], jim: 'bob' });
    }).toThrowErrorMatchingInlineSnapshot(
      `"The actionParams is invalid: [jim]: definition for this key is missing"`
    );

    expect(() => {
      validateActionTypeParams(actionType, {});
    }).toThrowErrorMatchingInlineSnapshot(
      `"The actionParams is invalid: [documents]: expected value of type [array] but got [undefined]"`
    );

    expect(() => {
      validateActionTypeParams(actionType, { index: 666 });
    }).toThrowErrorMatchingInlineSnapshot(
      `"The actionParams is invalid: [index]: expected value of type [string] but got [number]"`
    );

    expect(() => {
      validateActionTypeParams(actionType, { executionTimeField: true });
    }).toThrowErrorMatchingInlineSnapshot(
      `"The actionParams is invalid: [executionTimeField]: expected value of type [string] but got [boolean]"`
    );

    expect(() => {
      validateActionTypeParams(actionType, { refresh: 'true' });
    }).toThrowErrorMatchingInlineSnapshot(
      `"The actionParams is invalid: [refresh]: expected value of type [boolean] but got [string]"`
    );

    expect(() => {
      validateActionTypeParams(actionType, { documents: ['should be an object'] });
    }).toThrowErrorMatchingInlineSnapshot(
      `"The actionParams is invalid: [documents.0]: expected value of type [object] but got [string]"`
    );
  });
});

describe('execute()', () => {
  test('ensure parameters are as expected', async () => {
    let config: ActionTypeConfigType;
    let params: ActionParamsType;
    let executorOptions: ActionTypeExecutorOptions;

    // minimal params, index via param
    config = { index: null };
    params = {
      index: 'index-via-param',
      documents: [{ jim: 'bob' }],
      executionTimeField: undefined,
      refresh: undefined,
    };

    const id = 'some-id';

    executorOptions = { id, config, params, services };
    services.callCluster.mockClear();
    await actionType.executor(executorOptions);

    expect(services.callCluster.mock.calls).toMatchInlineSnapshot(`
          Array [
            Array [
              "bulk",
              Object {
                "body": Array [
                  Object {
                    "index": Object {},
                  },
                  Object {
                    "jim": "bob",
                  },
                ],
                "index": "index-via-param",
              },
            ],
          ]
    `);

    // full params (except index), index via config
    config = { index: 'index-via-config' };
    params = {
      index: undefined,
      documents: [{ jimbob: 'jr' }],
      executionTimeField: 'field_to_use_for_time',
      refresh: true,
    };

    executorOptions = { id, config, params, services };
    services.callCluster.mockClear();
    await actionType.executor(executorOptions);

    const calls = services.callCluster.mock.calls;
    const timeValue = calls[0][1].body[1].field_to_use_for_time;
    expect(timeValue).toBeInstanceOf(Date);
    delete calls[0][1].body[1].field_to_use_for_time;
    expect(calls).toMatchInlineSnapshot(`
        Array [
          Array [
            "bulk",
            Object {
              "body": Array [
                Object {
                  "index": Object {},
                },
                Object {
                  "jimbob": "jr",
                },
              ],
              "index": "index-via-config",
              "refresh": true,
            },
          ],
        ]
    `);

    // minimal params, index via config and param
    config = { index: 'index-via-config' };
    params = {
      index: 'index-via-param',
      documents: [{ jim: 'bob' }],
      executionTimeField: undefined,
      refresh: undefined,
    };

    executorOptions = { id, config, params, services };
    services.callCluster.mockClear();
    await actionType.executor(executorOptions);

    expect(services.callCluster.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          "bulk",
          Object {
            "body": Array [
              Object {
                "index": Object {},
              },
              Object {
                "jim": "bob",
              },
            ],
            "index": "index-via-config",
          },
        ],
      ]
    `);

    // multiple documents
    config = { index: null };
    params = {
      index: 'index-via-param',
      documents: [{ a: 1 }, { b: 2 }],
      executionTimeField: undefined,
      refresh: undefined,
    };

    executorOptions = { id, config, params, services };
    services.callCluster.mockClear();
    await actionType.executor(executorOptions);

    expect(services.callCluster.mock.calls).toMatchInlineSnapshot(`
          Array [
            Array [
              "bulk",
              Object {
                "body": Array [
                  Object {
                    "index": Object {},
                  },
                  Object {
                    "a": 1,
                  },
                  Object {
                    "index": Object {},
                  },
                  Object {
                    "b": 2,
                  },
                ],
                "index": "index-via-param",
              },
            ],
          ]
    `);
  });
});