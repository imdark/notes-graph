import { Injectable } from '@nestjs/common';
import type { RegistryJob } from '@prisma/client';

/** What a gate is asked about a job before it exists. */
export interface GateQuery {
  workspaceId: string;
  agentId: string;
  deviceKey: string;
}

/**
 * Something an agent job must wait on before any runner may take it: an
 * automation's prestart hook, say. A job a gate holds is created 'held'; the
 * gate later lets it go to the queue or fails it (RegistryJobService
 * releaseHeld / failHeld).
 */
export interface JobGate {
  /** Whether this job must wait on the gate. */
  holds(query: GateQuery): Promise<boolean>;
  /** Start what the held job waits on. Throwing fails the job. */
  start(job: RegistryJob): Promise<void>;
}

/**
 * The gates agent jobs pass through. Other modules register theirs at
 * startup, so the registry needn't know them.
 */
@Injectable()
export class JobGates {
  private readonly gates: JobGate[] = [];

  register(gate: JobGate) {
    this.gates.push(gate);
  }

  async holds(query: GateQuery): Promise<boolean> {
    for (const gate of this.gates) {
      if (await gate.holds(query)) return true;
    }
    return false;
  }

  async start(job: RegistryJob): Promise<void> {
    for (const gate of this.gates) {
      if (await gate.holds(job)) await gate.start(job);
    }
  }
}
