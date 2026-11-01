/**
 * Milestone keys the runner records for a committed action. They are the only keys recorded at the
 * action-start boundary. Model-emitted keys and `prestige.first` are recorded at a tick end.
 * Not exported from the package barrel.
 */
export function actionMilestoneKeys(actionId: string): readonly [string, string] {
  return [`action.${actionId}.firstApplied`, "progress.first-upgrade"];
}

/**
 * Whether a key that has not fired yet could next be recorded at an action start. A model may emit an
 * action-shaped key itself, so this only says the action-start boundary is possible.
 */
export function mayRecordAtActionStart(key: string): boolean {
  return key === "progress.first-upgrade" || (key.startsWith("action.") && key.endsWith(".firstApplied"));
}
