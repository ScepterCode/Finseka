export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      branches: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contribution_expenses: {
        Row: {
          amount: number
          contribution_id: string
          created_at: string
          description: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          org_id: string
          spent_at: string
          updated_at: string
        }
        Insert: {
          amount?: number
          contribution_id: string
          created_at?: string
          description: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          org_id: string
          spent_at?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          contribution_id?: string
          created_at?: string
          description?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          org_id?: string
          spent_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contribution_expenses_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contribution_members: {
        Row: {
          contribution_id: string
          id: string
          member_id: string
          org_id: string
        }
        Insert: {
          contribution_id: string
          id?: string
          member_id: string
          org_id: string
        }
        Update: {
          contribution_id?: string
          id?: string
          member_id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contribution_members_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contribution_payments: {
        Row: {
          amount: number
          contribution_id: string
          created_at: string
          id: string
          member_id: string
          method: Database["public"]["Enums"]["payment_method"]
          client_ref: string | null
          note: string | null
          org_id: string
          paid_at: string
        }
        Insert: {
          amount?: number
          contribution_id: string
          created_at?: string
          id?: string
          member_id: string
          method?: Database["public"]["Enums"]["payment_method"]
          client_ref?: string | null
          note?: string | null
          org_id: string
          paid_at?: string
        }
        Update: {
          amount?: number
          contribution_id?: string
          created_at?: string
          id?: string
          member_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          client_ref?: string | null
          note?: string | null
          org_id?: string
          paid_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contribution_payments_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contributions: {
        Row: {
          amount_per_person: number
          budget_amount: number | null
          closed: boolean
          committee: string[]
          created_at: string
          due_date: string | null
          expenses_posted: boolean
          id: string
          mandatory: boolean
          name: string
          org_id: string
          reason: string | null
          target_amount: number | null
        }
        Insert: {
          amount_per_person?: number
          budget_amount?: number | null
          closed?: boolean
          committee?: string[]
          created_at?: string
          due_date?: string | null
          expenses_posted?: boolean
          id?: string
          mandatory?: boolean
          name: string
          org_id: string
          reason?: string | null
          target_amount?: number | null
        }
        Update: {
          amount_per_person?: number
          budget_amount?: number | null
          closed?: boolean
          committee?: string[]
          created_at?: string
          due_date?: string | null
          expenses_posted?: boolean
          id?: string
          mandatory?: boolean
          name?: string
          org_id?: string
          reason?: string | null
          target_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contributions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      due_payments: {
        Row: {
          amount: number
          created_at: string
          due_id: string
          id: string
          member_id: string
          method: Database["public"]["Enums"]["payment_method"]
          client_ref: string | null
          note: string | null
          org_id: string
          paid_at: string
          period_label: string
        }
        Insert: {
          amount?: number
          created_at?: string
          due_id: string
          id?: string
          member_id: string
          method?: Database["public"]["Enums"]["payment_method"]
          client_ref?: string | null
          note?: string | null
          org_id: string
          paid_at?: string
          period_label: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_id?: string
          id?: string
          member_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          client_ref?: string | null
          note?: string | null
          org_id?: string
          paid_at?: string
          period_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "due_payments_due_id_fkey"
            columns: ["due_id"]
            isOneToOne: false
            referencedRelation: "dues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "due_payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "due_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dues: {
        Row: {
          active: boolean
          amount: number
          created_at: string
          frequency: Database["public"]["Enums"]["due_frequency"]
          id: string
          name: string
          notes: string | null
          org_id: string
          penalty_amount: number
          penalty_grace_days: number
        }
        Insert: {
          active?: boolean
          amount?: number
          created_at?: string
          frequency?: Database["public"]["Enums"]["due_frequency"]
          id?: string
          name: string
          notes?: string | null
          org_id: string
          penalty_amount?: number
          penalty_grace_days?: number
        }
        Update: {
          active?: boolean
          amount?: number
          created_at?: string
          frequency?: Database["public"]["Enums"]["due_frequency"]
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          penalty_amount?: number
          penalty_grace_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "dues_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          entry_date: string
          id: string
          kind: Database["public"]["Enums"]["ledger_kind"]
          label: string
          member_id: string | null
          method: Database["public"]["Enums"]["payment_method"]
          org_id: string
          source_id: string | null
          source_table: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          description?: string | null
          entry_date?: string
          id?: string
          kind: Database["public"]["Enums"]["ledger_kind"]
          label: string
          member_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          org_id: string
          source_id?: string | null
          source_table?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          entry_date?: string
          id?: string
          kind?: Database["public"]["Enums"]["ledger_kind"]
          label?: string
          member_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          org_id?: string
          source_id?: string | null
          source_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          active: boolean
          branch_id: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          phone: string | null
          tags: string[]
        }
        Insert: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          phone?: string | null
          tags?: string[]
        }
        Update: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          phone?: string | null
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "members_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          logo_url: string | null
          name: string
          opening_balance_set: boolean
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          logo_url?: string | null
          name: string
          opening_balance_set?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          logo_url?: string | null
          name?: string
          opening_balance_set?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          must_change_password: boolean
          org_id: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          must_change_password?: boolean
          org_id?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          must_change_password?: boolean
          org_id?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          org_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      contribution_progress: { Args: { _open_only?: boolean }; Returns: Json }
      current_org_id: { Args: never; Returns: string }
      dashboard_summary: { Args: { _periods: Json }; Returns: Json }
      ledger_totals: { Args: { _from?: string; _to?: string }; Returns: Json }
      member_balances: {
        Args: { _member_id?: string; _periods: Json }
        Returns: {
          contributions_owing: number
          dues_owing: number
          member_id: string
          name: string
          penalties: number
          total_owing: number
        }[]
      }
      report_summary: {
        Args: { _from: string; _periods: Json; _to: string }
        Returns: Json
      }
      standing_lines: {
        Args: { _member_id?: string; _periods: Json }
        Returns: {
          expected: number
          is_current: boolean
          is_past: boolean
          kind: string
          member_id: string
          paid: number
          penalty: number
          period_label: string | null
          ref_id: string
          ref_name: string
          short: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_admin: { Args: never; Returns: boolean }
      post_contribution_expenses: {
        Args: { _contribution_id: string }
        Returns: undefined
      }
      setup_organization: {
        Args: { _full_name: string; _org_name: string; _phone?: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "viewer"
      due_frequency: "daily" | "weekly" | "monthly" | "yearly" | "custom"
      ledger_kind: "income" | "expense"
      payment_method: "cash" | "transfer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "viewer"],
      due_frequency: ["daily", "weekly", "monthly", "yearly", "custom"],
      ledger_kind: ["income", "expense"],
      payment_method: ["cash", "transfer"],
    },
  },
} as const
