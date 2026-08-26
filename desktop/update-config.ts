export const updateConfig = {
  owner: 'kadev-code',
  repository: 'AmbroStudio',
} as const;

export function isUpdateConfigured() {
  return Boolean(updateConfig.owner && updateConfig.repository);
}
