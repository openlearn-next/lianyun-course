/**
 * Minimal in-memory mock for OpenLearn PluginContext.
 *
 * Replaces the unmaintained @openlearn/plugin-test-kit dependency.
 * Supports: commandBus.register/execute, eventBus.publish/subscribe,
 * storage.set/get/delete, processManager.spawn/registerHandler, and a
 * good-enough SQLite-like facade (rawDb) so plugin.activate() can
 * complete without hitting a real database.
 */

import type { PluginContext } from '@openlearn/plugin-sdk';

type Handler = { execute: (cmd: any) => Promise<any> };
type Subscriber = (evt: any) => void | Promise<void>;

interface MockOptions {
  pluginId?: string;
  /** Whether ctx.services.* is wired (default true). */
  wireServices?: boolean;
}

export interface MockContext {
  pluginId: string;
  services: {
    commandBus: {
      registerHandler: (type: string, h: Handler) => Promise<void>;
      execute: (cmd: any) => Promise<any>;
    };
    eventBus: {
      publish: (evt: any) => Promise<void>;
      subscribe: (type: string, fn: Subscriber) => Subscriber;
    };
    actionRegistry: {
      register: (action: any) => Promise<void>;
    };
    storage: {
      set: (k: string, v: any) => Promise<void>;
      get: (k: string) => Promise<any>;
      delete: (k: string) => Promise<void>;
    };
    processManager: {
      spawn: (name: string, taskType: string, payload: any) => Promise<string>;
      registerHandler: (taskType: string, handler: any) => Promise<void>;
    };
  };
  resolve: (token: any) => Promise<any>;
  provide: (token: any, instance: any) => Promise<void>;
  db: { ensureTable: (name: string, def: string) => Promise<void> };
  log: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void; debug: (...args: any[]) => void };
  config: Record<string, any>;
  manifest: Record<string, any>;
  /** Test-only escape hatch to inspect storage / handlers. */
  _rawDb: any;
  _handlers: Map<string, Handler>;
  _subscribers: Map<string, Subscriber[]>;
  _storage: Map<string, any>;
}

export function createMockContext(opts: MockOptions = {}): MockContext {
  const handlers = new Map<string, Handler>();
  const subscribers = new Map<string, Subscriber[]>();
  const storage = new Map<string, any>();
  const processHandlers = new Map<string, any>();

  // Minimal SQLite-like facade. Stores rows by table name. For lianyun-course
  // 4 张表以及平台 classes/students/class_students，我们硬编码列顺序，
  // 让 SELECT * 能返回与真实 SQLite 一致的字段名。
  const TABLE_COLUMNS: Record<string, string[]> = {
    plugin_research_activities: [
      'id', 'title', 'description', 'teacher_id', 'class_id', 'current_phase',
      'config', 'rubrics', 'created_at', 'updated_at',
    ],
    plugin_research_groups: [
      'id', 'activity_id', 'group_name', 'leader_student_id', 'member_ids', 'created_at',
    ],
    plugin_research_submissions: [
      'id', 'activity_id', 'group_id', 'student_id', 'version', 'title', 'summary',
      'attachments', 'ai_check_result', 'status', 'created_at',
    ],
    plugin_research_reviews: [
      'id', 'submission_id', 'reviewer_id', 'review_type', 'scores', 'total_score',
      'comments', 'decision', 'created_at',
    ],
    classes: ['id', 'name', 'description', 'created_at'],
    students: ['id', 'name', 'student_number'],
    class_students: ['class_id', 'student_id'],
  };
  const tables = new Map<string, any[]>();

  const rawDb = {
    exec(sql: string) {
      // Crude CREATE TABLE / ALTER TABLE handling — enough for plugin.activate.
      const matches = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi) || [];
      for (const m of matches) {
        const name = m.split(/\s+/).pop()!;
        if (!tables.has(name)) tables.set(name, []);
      }
      const alters = sql.match(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/gi) || [];
      for (const a of alters) {
        const parts = a.split(/\s+/);
        const tableName = parts[1];
        const colName = parts[parts.length - 1].replace(/[(),;]/g, '');
        if (TABLE_COLUMNS[tableName] && !TABLE_COLUMNS[tableName].includes(colName)) {
          TABLE_COLUMNS[tableName].splice(TABLE_COLUMNS[tableName].length - 1, 0, colName);
        }
      }
    },
    prepare(sql: string) {
      const trimmed = sql.trim();
      const isInsert = /^INSERT INTO/i.test(trimmed);
      const isSelect = /^SELECT/i.test(trimmed);
      const isUpdate = /^UPDATE/i.test(trimmed);
      const isDelete = /^DELETE/i.test(trimmed);
      const tableMatch = trimmed.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i);
      const table = tableMatch?.[1] ?? '';
      const cols = TABLE_COLUMNS[table];

      const buildRow = (values: any[]): any => {
        const row: any = {};
        if (cols) {
          cols.forEach((c, i) => (row[c] = values[i]));
        } else {
          // 未知表:退化到 col_n 字段
          row.id = values[0];
          for (let i = 1; i < values.length; i++) row[`col_${i}`] = values[i];
        }
        return row;
      };

      return {
        run(...args: any[]) {
          if (!tables.has(table)) tables.set(table, []);
          const rows = tables.get(table)!;
          if (isInsert) {
            const row = buildRow(args);
            rows.push(row);
            return { changes: 1, lastInsertRowid: row.id };
          }
          if (isUpdate) {
            // UPDATE table SET col1=?, col2=? WHERE id=?
            const setCount = (trimmed.match(/=/g) || []).length - 1;
            const setValues = args.slice(0, setCount);
            const whereValue = args[setCount];
            let changed = 0;
            for (const r of rows) {
              if (r.id === whereValue) {
                setValues.forEach((v: any, i: number) => {
                  // 提取 SET 后第一个列名
                  const setClause = trimmed.split(/SET\s+/i)[1].split(/\s+WHERE\b/i)[0];
                  const colNames = setClause.split(',').map((s) => s.split('=')[0].trim());
                  r[colNames[i]] = v;
                });
                changed++;
              }
            }
            return { changes: changed };
          }
          if (isDelete) {
            const before = rows.length;
            // 极简：只支持单 WHERE id=?
            const whereMatch = trimmed.match(/WHERE\s+(\w+)\s*=\s*\?/i);
            const whereCol = whereMatch?.[1] ?? 'id';
            const whereValue = args[args.length - 1];
            const filtered = rows.filter((r) => r[whereCol] !== whereValue);
            tables.set(table, filtered);
            return { changes: before - filtered.length };
          }
          return { changes: 0 };
        },
        get(...args: any[]) {
          if (!tables.has(table)) return undefined;
          const rows = tables.get(table)!;
          if (args.length === 1) {
            // 默认 WHERE id=?
            return rows.find((r) => r.id === args[0]);
          }
          // 其它单条件 WHERE col=?
          const whereMatch = trimmed.match(/WHERE\s+(\w+)\s*=\s*\?/i);
          const whereCol = whereMatch?.[1] ?? 'id';
          return rows.find((r) => r[whereCol] === args[0]);
        },
        all(...args: any[]) {
          if (!tables.has(table)) return [];
          const arr = [...tables.get(table)!];
          if (args.length === 0) return arr;
          // 简化：返回全部，调用方按需过滤
          return arr;
        },
      };
    },
  };

  const log = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  const commandBus = {
    async registerHandler(type: string, h: Handler) {
      handlers.set(type, h);
    },
    async execute(cmd: any) {
      const h = handlers.get(cmd.type);
      if (!h) throw new Error(`No handler registered for ${cmd.type}`);
      // 测试便利：默认填充 actorId，避免每个用例手写。可被具体用例覆盖。
      const withDefaults = {
        actorId: 'test_actor',
        ...cmd,
        payload: { ...(cmd.payload || {}) },
      };
      return await h.execute(withDefaults);
    },
  };

  const eventBus = {
    async publish(evt: any) {
      const subs = subscribers.get(evt.type) || [];
      for (const s of subs) {
        try {
          await s(evt);
        } catch {
          /* swallow to match production */
        }
      }
    },
    subscribe(type: string, fn: Subscriber) {
      const list = subscribers.get(type) || [];
      list.push(fn);
      subscribers.set(type, list);
      return fn;
    },
  };

  const actionRegistry = {
    async register(action: any) {
      // No-op for tests; could collect if needed.
    },
  };

  const storageService = {
    async set(k: string, v: any) {
      storage.set(k, v);
    },
    async get(k: string) {
      return storage.get(k);
    },
    async delete(k: string) {
      storage.delete(k);
    },
  };

  const processManager = {
    async spawn(name: string, taskType: string, payload: any) {
      const handler = processHandlers.get(taskType);
      const processId = `proc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (handler) {
        // Fire and forget; production semantics.
        Promise.resolve()
          .then(() => handler(processId, payload, undefined, () => {}, () => {}))
          .catch(() => {});
      }
      return processId;
    },
    async registerHandler(taskType: string, handler: any) {
      processHandlers.set(taskType, handler);
    },
  };

  return {
    pluginId: opts.pluginId || 'test-plugin',
    services: {
      commandBus,
      eventBus,
      actionRegistry,
      storage: storageService,
      processManager,
    },
    async resolve() {
      // Return null so plugin falls back to memory store path. To exercise
      // the DB path, inject a custom rawDb via the helper below.
      return null;
    },
    async provide() {
      /* no-op */
    },
    db: { async ensureTable() { /* no-op */ } },
    log,
    config: {},
    manifest: {},
    _rawDb: rawDb,
    _handlers: handlers,
    _subscribers: subscribers,
    _storage: storage,
  };
}

/**
 * Variant of createMockContext that resolves all DI tokens to working fakes.
 * Use this when you want to exercise the SQLite / processManager paths.
 */
export function createWiredMockContext(opts: MockOptions = {}): MockContext {
  const ctx = createMockContext(opts);
  // Override resolve() to return the in-memory SQLite facade so plugin's
  // initServicesAndDb can populate rawDb.
  const realResolve = ctx.resolve;
  ctx.resolve = async (token: any) => {
    const id = String(token?.name || token?._id || token?.id || '');
    if (id.includes('IDatabase')) return ctx._rawDb;
    if (id.includes('IProcessService')) return ctx.services.processManager;
    if (id.includes('IStorage')) return ctx.services.storage;
    if (id.includes('ICommandBus')) return ctx.services.commandBus;
    if (id.includes('IEventBus')) return ctx.services.eventBus;
    if (id.includes('IActionRegistry')) return ctx.services.actionRegistry;
    if (id.includes('IPointsLedger')) {
      return { async addPoints() { return { id: 'mock' }; } };
    }
    if (id.includes('ICapabilityService')) {
      // 测试环境默认全放行；专门测试拒绝路径时可覆盖。
      return {
        async check(_actorId: string, _cap: string) { return true; },
      };
    }
    if (id.includes('IPointsDimensionRegistry')) {
      return { registerDimension() {} };
    }
    if (id.includes('IActivityRegistry')) {
      return { registerProvider() {} };
    }
    return realResolve(token);
  };
  return ctx;
}
