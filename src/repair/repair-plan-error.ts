export class RepairPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepairPlanError";
  }
}
