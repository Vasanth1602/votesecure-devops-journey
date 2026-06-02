export function hasRole(user, role) {
  if (!role) return true;
  return user?.role === role;
}
