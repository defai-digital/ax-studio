
import { test, expect } from 'vitest'
import * as assistant from './assistant';
import * as model from './model';
import * as thread from './thread';
import * as message from './message';
import * as inference from './inference';
import * as file from './file';
import * as config from './config';
import * as api from './api';
import * as setting from './setting';
import * as engine from './engine';
import * as hardware from './hardware';
import * as mcp from './mcp';

test('test_module_exports', () => {
      expect(assistant).toBeDefined();
      expect(model).toBeDefined();
      expect(thread).toBeDefined();
      expect(message).toBeDefined();
      expect(inference).toBeDefined();
      expect(file).toBeDefined();
      expect(config).toBeDefined();
      expect(api).toBeDefined();
      expect(setting).toBeDefined();
      expect(engine).toBeDefined();
      expect(hardware).toBeDefined();
      expect(mcp).toBeDefined();
    });
