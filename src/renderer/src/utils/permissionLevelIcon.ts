import { Shield, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";

export type PermissionStrength = "strict" | "standard" | "relaxed" | "unknown";

export function permissionStrengthIcon(strength: PermissionStrength) {
	if (strength === "strict") return ShieldAlert;
	if (strength === "standard") return ShieldCheck;
	if (strength === "relaxed") return ShieldOff;
	return Shield;
}
