import type {
  DocumentData,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { OnboardingStore } from "../../src/lib/onboarding/store";
import { createOnboardingHandler } from "../../src/lib/onboarding/handler";
import type { OnboardingState } from "../../src/lib/onboarding/types";
import { QUESTIONNAIRE_VERSION } from "../../src/lib/onboarding/questionnaires";

type Data = Record<string, unknown>;

function merge(previous: Data, next: Data): Data {
  return Object.fromEntries(
    [...new Set([...Object.keys(previous), ...Object.keys(next)])].map(
      (key) => {
        const value = next[key];
        const before = previous[key];
        if (!(key in next)) return [key, before];
        if (
          value &&
          before &&
          typeof value === "object" &&
          typeof before === "object" &&
          !Array.isArray(value) &&
          !Array.isArray(before) &&
          Object.keys(value).length
        ) {
          return [key, merge(before as Data, value as Data)];
        }
        return [key, value];
      },
    ),
  );
}

export class MemoryFirestore {
  readonly records = new Map<string, DocumentData>();
  writes = 0;
  private queue = Promise.resolve();

  collection(path: string) {
    return { doc: (id: string) => this.ref(`${path}/${id}`) };
  }

  private ref(path: string): MemoryReference {
    return {
      path,
      id: path.split("/").at(-1)!,
      get: async () => this.snapshot(path),
      collection: (name: string) => this.collection(`${path}/${name}`),
    };
  }

  private snapshot(path: string) {
    return {
      exists: this.records.has(path),
      id: path.split("/").at(-1)!,
      data: () => structuredClone(this.records.get(path)),
    };
  }

  async runTransaction<T>(
    callback: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.queue;
    let release = () => {};
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const writes: Array<{ path: string; data: Data; merge: boolean }> = [];
    try {
      const transaction = {
        get: async (ref: MemoryReference) => {
          if (writes.length)
            throw new Error(
              "Firestore transactions must perform reads before writes",
            );
          return this.snapshot(ref.path);
        },
        set: (
          ref: MemoryReference,
          data: Data,
          options?: { merge?: boolean },
        ) => {
          writes.push({
            path: ref.path,
            data: structuredClone(data),
            merge: Boolean(options?.merge),
          });
        },
      } as unknown as Transaction;
      const result = await callback(transaction);
      for (const write of writes) {
        this.records.set(
          write.path,
          write.merge
            ? merge(this.records.get(write.path) ?? {}, write.data)
            : write.data,
        );
        this.writes++;
      }
      return result;
    } finally {
      release();
    }
  }

  get db() {
    return this as unknown as Firestore;
  }
}

interface MemoryReference {
  path: string;
  id: string;
  get: () => Promise<{
    exists: boolean;
    id: string;
    data: () => DocumentData | undefined;
  }>;
  collection: (name: string) => { doc: (id: string) => MemoryReference };
}

export function writeContext(state: OnboardingState) {
  return {
    goalId: state.goal?.id,
    goalRevision: state.goal?.revision ?? 0,
    profileVersion: state.profile.version,
    questionnaireVersion: QUESTIONNAIRE_VERSION,
  };
}

export function fixture(uid = "test-user", memory = new MemoryFirestore()) {
  const store = new OnboardingStore(memory.db);
  const handlers = createOnboardingHandler(async (token, revoked) => {
    if (token !== uid || !revoked) throw new Error("Rejected test identity");
    return { uid } as DecodedIdToken;
  }, store, { read: async () => ({ allowed: true, retryAfterSeconds: 1 }), write: async () => ({ allowed: true, retryAfterSeconds: 1 }) });
  return {
    uid,
    memory,
    store,
    handlers,
    state: () => store.load(uid),
    post: async (
      body: Record<string, unknown>,
      state?: OnboardingState,
      profileOnly = false,
    ) => {
      const current = state ?? (await store.load(uid));
      const request = new Request("http://localhost/api/onboarding", {
        method: profileOnly ? "PATCH" : "POST",
        headers: {
          authorization: `Bearer ${uid}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...writeContext(current),
          activeGoalId: current.account.activeGoalId,
          ...body,
        }),
      });
      return (profileOnly ? handlers.PATCH : handlers.POST)(request);
    },
  };
}

export const resumeFixture = {
  name: "Ada Builder",
  location: "Bengaluru",
  skills: ["TypeScript", "Postgres"],
  links: [
    { label: "GitHub", url: "https://github.com/example" },
    { label: "LinkedIn", url: "https://linkedin.com/in/example" },
  ],
  workExperience: [
    {
      company: "EarlyCo",
      role: "Engineer",
      duration: "2024 - 2026",
      description: ["Cut invoice processing time by 40%."],
    },
  ],
  projects: [
    {
      name: "Ledger",
      description: ["Shipped a billing tool used by 50 teams."],
      url: "https://example.com/ledger",
    },
  ],
};
