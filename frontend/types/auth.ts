import type { BusinessPreset } from './pos';

export interface RegisterCompanyRequest {
  company_name: string;
  business_preset: BusinessPreset;
  owner_name: string;
  phone: string;
  password: string;
  city?: string;
  state: string;
}

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface PinLoginRequest {
  store_code: string;
  pin: string;
}

export interface AuthProfile {
  user: { id: string; full_name: string; phone: string | null };
  tenant: { id: string; name: string; tenant_code: string };
  store: { id: string; code: string; name: string; business_preset: BusinessPreset };
  role: string;
}

export interface MeResponse {
  user: { id: string; full_name: string; phone: string | null };
  tenant_id: string;
  role: string;
  store: {
    id: string;
    code: string;
    name: string;
    business_preset: BusinessPreset;
    default_mode: string;
    config: Record<string, unknown>;
  };
  active_shift: { id: string; status: string; opened_at: string } | null;
}
