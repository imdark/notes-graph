export interface AgentPushRegistration {
  /** This install's FCM token; null when the build has no Firebase project. */
  token: string | null;
  /** The servers that accepted it. */
  registered: string[];
  permission?: string;
}

export interface AgentPushPlugin {
  /**
   * Get pushes from these servers when an agent run there is waiting on the
   * signed-in user. Asks for the notification permission the first time.
   * Pushes from any server left out are dropped on the phone from now on.
   */
  register(options: { servers: string[] }): Promise<AgentPushRegistration>;
  /** Stop a server pushing to this phone (sign-out). */
  unregister(options: { server: string }): Promise<{ ok: boolean }>;
}
