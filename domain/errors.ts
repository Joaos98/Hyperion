/** Raised when a domain rule refuses an operation — never for I/O or infrastructure failure. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainError'
  }
}
