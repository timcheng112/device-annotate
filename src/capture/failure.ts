/** Operational failures expose fixed diagnostics, never transport credentials or stacks. */
export class CaptureFailure extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CaptureFailure';
  }
}
