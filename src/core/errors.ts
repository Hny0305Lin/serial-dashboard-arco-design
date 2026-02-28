export class ESerialBusy extends Error {
  code = 'ESerialBusy' as const;
  lockedPid?: number;
  lockFilePath?: string;

  constructor(message: string, options?: { lockedPid?: number; lockFilePath?: string }) {
    super(message);
    this.name = 'ESerialBusy';
    this.lockedPid = options?.lockedPid;
    this.lockFilePath = options?.lockFilePath;
  }
}
