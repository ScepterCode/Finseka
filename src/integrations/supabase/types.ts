export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_label: string | null;
          at: string;
          id: number;
          new_row: Json | null;
          old_row: Json | null;
          org_id: string;
          row_id: string | null;
          table_name: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_label?: string | null;
          at?: string;
          id?: number;
          new_row?: Json | null;
          old_row?: Json | null;
          org_id: string;
          row_id?: string | null;
          table_name: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_label?: string | null;
          at?: string;
          id?: number;
          new_row?: Json | null;
          old_row?: Json | null;
          org_id?: string;
          row_id?: string | null;
          table_name?: string;
        };
        Relationships: [];
      };
      org_billing: {
        Row: {
          auto_renew_cancelled_at: string | null;
          free_plan: boolean;
          org_id: string;
          paid_until: string | null;
          provider: string | null;
          provider_email: string | null;
          provider_subscription_id: string | null;
          trial_ends_at: string;
          updated_at: string;
        };
        Insert: {
          auto_renew_cancelled_at?: string | null;
          free_plan?: boolean;
          org_id?: string;
          paid_until?: string | null;
          provider?: string | null;
          provider_email?: string | null;
          provider_subscription_id?: string | null;
          trial_ends_at?: string;
          updated_at?: string;
        };
        Update: {
          auto_renew_cancelled_at?: string | null;
          free_plan?: boolean;
          org_id?: string;
          paid_until?: string | null;
          provider?: string | null;
          provider_email?: string | null;
          provider_subscription_id?: string | null;
          trial_ends_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      branches: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          org_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          org_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branches_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      contribution_expenses: {
        Row: {
          amount: number;
          contribution_id: string;
          created_at: string;
          description: string;
          id: string;
          method: Database["public"]["Enums"]["payment_method"];
          channel: Database["public"]["Enums"]["payment_channel"];
          reference: string | null;
          org_id: string;
          spent_at: string;
          updated_at: string;
        };
        Insert: {
          amount?: number;
          contribution_id: string;
          created_at?: string;
          description: string;
          id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          channel?: Database["public"]["Enums"]["payment_channel"];
          reference?: string | null;
          org_id: string;
          spent_at?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          contribution_id?: string;
          created_at?: string;
          description?: string;
          id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          channel?: Database["public"]["Enums"]["payment_channel"];
          reference?: string | null;
          org_id?: string;
          spent_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contribution_expenses_contribution_id_fkey";
            columns: ["contribution_id"];
            isOneToOne: false;
            referencedRelation: "contributions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contribution_expenses_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      contribution_members: {
        Row: {
          contribution_id: string;
          id: string;
          member_id: string;
          org_id: string;
        };
        Insert: {
          contribution_id: string;
          id?: string;
          member_id: string;
          org_id: string;
        };
        Update: {
          contribution_id?: string;
          id?: string;
          member_id?: string;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contribution_members_contribution_id_fkey";
            columns: ["contribution_id"];
            isOneToOne: false;
            referencedRelation: "contributions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contribution_members_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contribution_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      contribution_payments: {
        Row: {
          amount: number;
          contribution_id: string;
          created_at: string;
          id: string;
          member_id: string;
          method: Database["public"]["Enums"]["payment_method"];
          channel: Database["public"]["Enums"]["payment_channel"];
          reference: string | null;
          client_ref: string | null;
          note: string | null;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          org_id: string;
          paid_at: string;
        };
        Insert: {
          amount?: number;
          contribution_id: string;
          created_at?: string;
          id?: string;
          member_id: string;
          method?: Database["public"]["Enums"]["payment_method"];
          channel?: Database["public"]["Enums"]["payment_channel"];
          reference?: string | null;
          client_ref?: string | null;
          note?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          org_id: string;
          paid_at?: string;
        };
        Update: {
          amount?: number;
          contribution_id?: string;
          created_at?: string;
          id?: string;
          member_id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          channel?: Database["public"]["Enums"]["payment_channel"];
          reference?: string | null;
          client_ref?: string | null;
          note?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          org_id?: string;
          paid_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contribution_payments_contribution_id_fkey";
            columns: ["contribution_id"];
            isOneToOne: false;
            referencedRelation: "contributions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contribution_payments_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contribution_payments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      contributions: {
        Row: {
          accepts_pledges: boolean;
          amount_per_person: number;
          budget_amount: number | null;
          closed: boolean;
          committee: string[];
          created_at: string;
          due_date: string | null;
          expenses_posted: boolean;
          id: string;
          mandatory: boolean;
          name: string;
          org_id: string;
          reason: string | null;
          target_amount: number | null;
        };
        Insert: {
          accepts_pledges?: boolean;
          amount_per_person?: number;
          budget_amount?: number | null;
          closed?: boolean;
          committee?: string[];
          created_at?: string;
          due_date?: string | null;
          expenses_posted?: boolean;
          id?: string;
          mandatory?: boolean;
          name: string;
          org_id: string;
          reason?: string | null;
          target_amount?: number | null;
        };
        Update: {
          accepts_pledges?: boolean;
          amount_per_person?: number;
          budget_amount?: number | null;
          closed?: boolean;
          committee?: string[];
          created_at?: string;
          due_date?: string | null;
          expenses_posted?: boolean;
          id?: string;
          mandatory?: boolean;
          name?: string;
          org_id?: string;
          reason?: string | null;
          target_amount?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "contributions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      due_members: {
        Row: { due_id: string; id: string; member_id: string; org_id: string };
        Insert: { due_id: string; id?: string; member_id: string; org_id: string };
        Update: { due_id?: string; id?: string; member_id?: string; org_id?: string };
        Relationships: [];
      };
      due_payments: {
        Row: {
          amount: number;
          created_at: string;
          due_id: string;
          id: string;
          member_id: string;
          method: Database["public"]["Enums"]["payment_method"];
          channel: Database["public"]["Enums"]["payment_channel"];
          reference: string | null;
          client_ref: string | null;
          note: string | null;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          org_id: string;
          paid_at: string;
          period_label: string;
          period_start: string;
        };
        Insert: {
          amount?: number;
          created_at?: string;
          due_id: string;
          id?: string;
          member_id: string;
          method?: Database["public"]["Enums"]["payment_method"];
          channel?: Database["public"]["Enums"]["payment_channel"];
          reference?: string | null;
          client_ref?: string | null;
          note?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          org_id: string;
          paid_at?: string;
          period_label: string;
          period_start?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          due_id?: string;
          id?: string;
          member_id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          channel?: Database["public"]["Enums"]["payment_channel"];
          reference?: string | null;
          client_ref?: string | null;
          note?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          org_id?: string;
          paid_at?: string;
          period_label?: string;
          period_start?: string;
        };
        Relationships: [
          {
            foreignKeyName: "due_payments_due_id_fkey";
            columns: ["due_id"];
            isOneToOne: false;
            referencedRelation: "dues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "due_payments_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "due_payments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      due_rates: {
        Row: {
          amount: number;
          created_at: string;
          created_by: string | null;
          due_id: string;
          effective_from: string;
          id: string;
          org_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          created_by?: string | null;
          due_id: string;
          effective_from: string;
          id?: string;
          org_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          created_by?: string | null;
          due_id?: string;
          effective_from?: string;
          id?: string;
          org_id?: string;
        };
        Relationships: [];
      };
      dues: {
        Row: {
          audience: Database["public"]["Enums"]["due_audience"];
          audience_branch_ids: string[];
          audience_labels: string[];
          active: boolean;
          amount: number;
          created_at: string;
          frequency: Database["public"]["Enums"]["due_frequency"];
          id: string;
          name: string;
          notes: string | null;
          org_id: string;
          penalty_amount: number;
          penalty_grace_days: number;
          starts_on: string;
        };
        Insert: {
          audience?: Database["public"]["Enums"]["due_audience"];
          audience_branch_ids?: string[];
          audience_labels?: string[];
          active?: boolean;
          amount?: number;
          created_at?: string;
          frequency?: Database["public"]["Enums"]["due_frequency"];
          id?: string;
          name: string;
          notes?: string | null;
          org_id: string;
          penalty_amount?: number;
          penalty_grace_days?: number;
          starts_on?: string;
        };
        Update: {
          audience?: Database["public"]["Enums"]["due_audience"];
          audience_branch_ids?: string[];
          audience_labels?: string[];
          active?: boolean;
          amount?: number;
          created_at?: string;
          frequency?: Database["public"]["Enums"]["due_frequency"];
          id?: string;
          name?: string;
          notes?: string | null;
          org_id?: string;
          penalty_amount?: number;
          penalty_grace_days?: number;
          starts_on?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dues_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      fiscal_years: {
        Row: {
          id: string;
          org_id: string;
          starts_on: string;
          ends_on: string;
          closed_at: string;
          closed_by: string | null;
          opening_cash: number;
          opening_bank: number;
          income: number;
          expense: number;
          closing_cash: number;
          closing_bank: number;
          owed_at_close: number;
          notes: string | null;
        };
        Insert: {
          id?: string;
          org_id?: string;
          starts_on?: string;
          ends_on?: string;
          closed_at?: string;
          closed_by?: string | null;
          opening_cash?: number;
          opening_bank?: number;
          income?: number;
          expense?: number;
          closing_cash?: number;
          closing_bank?: number;
          owed_at_close?: number;
          notes?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          starts_on?: string;
          ends_on?: string;
          closed_at?: string;
          closed_by?: string | null;
          opening_cash?: number;
          opening_bank?: number;
          income?: number;
          expense?: number;
          closing_cash?: number;
          closing_bank?: number;
          owed_at_close?: number;
          notes?: string | null;
        };
        Relationships: [];
      };
      ledger_entries: {
        Row: {
          amount: number;
          created_at: string;
          description: string | null;
          entry_date: string;
          id: string;
          kind: Database["public"]["Enums"]["ledger_kind"];
          label: string;
          member_id: string | null;
          method: Database["public"]["Enums"]["payment_method"];
          channel: Database["public"]["Enums"]["payment_channel"];
          reference: string | null;
          org_id: string;
          source_id: string | null;
          source_table: string | null;
          reverse_reason: string | null;
          reversed_at: string | null;
          reversed_by: string | null;
          reverses_id: string | null;
        };
        Insert: {
          amount?: number;
          created_at?: string;
          description?: string | null;
          entry_date?: string;
          id?: string;
          kind: Database["public"]["Enums"]["ledger_kind"];
          label: string;
          member_id?: string | null;
          method?: Database["public"]["Enums"]["payment_method"];
          channel?: Database["public"]["Enums"]["payment_channel"];
          reference?: string | null;
          org_id: string;
          source_id?: string | null;
          source_table?: string | null;
          reverse_reason?: string | null;
          reversed_at?: string | null;
          reversed_by?: string | null;
          reverses_id?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          description?: string | null;
          entry_date?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["ledger_kind"];
          label?: string;
          member_id?: string | null;
          method?: Database["public"]["Enums"]["payment_method"];
          channel?: Database["public"]["Enums"]["payment_channel"];
          reference?: string | null;
          org_id?: string;
          source_id?: string | null;
          source_table?: string | null;
          reverse_reason?: string | null;
          reversed_at?: string | null;
          reversed_by?: string | null;
          reverses_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_entries_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_entries_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      members: {
        Row: {
          address: string | null;
          date_of_birth: string | null;
          email: string | null;
          gender: string | null;
          next_of_kin_name: string | null;
          next_of_kin_phone: string | null;
          occupation: string | null;
          active: boolean;
          branch_id: string | null;
          created_at: string;
          id: string;
          name: string;
          joined_on: string;
          org_id: string;
          phone: string | null;
          tags: string[];
        };
        Insert: {
          address?: string | null;
          date_of_birth?: string | null;
          email?: string | null;
          gender?: string | null;
          next_of_kin_name?: string | null;
          next_of_kin_phone?: string | null;
          occupation?: string | null;
          active?: boolean;
          branch_id?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          joined_on?: string;
          org_id: string;
          phone?: string | null;
          tags?: string[];
        };
        Update: {
          address?: string | null;
          date_of_birth?: string | null;
          email?: string | null;
          gender?: string | null;
          next_of_kin_name?: string | null;
          next_of_kin_phone?: string | null;
          occupation?: string | null;
          active?: boolean;
          branch_id?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          joined_on?: string;
          org_id?: string;
          phone?: string | null;
          tags?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "members_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      pledge_drives: {
        Row: {
          closed: boolean;
          closes_on: string | null;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          org_id: string;
          target_amount: number | null;
        };
        Insert: {
          closed?: boolean;
          closes_on?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          org_id: string;
          target_amount?: number | null;
        };
        Update: {
          closed?: boolean;
          closes_on?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          org_id?: string;
          target_amount?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "pledge_drives_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      pledge_payments: {
        Row: {
          amount: number;
          channel: Database["public"]["Enums"]["payment_channel"];
          client_ref: string | null;
          created_at: string;
          id: string;
          method: Database["public"]["Enums"]["payment_method"];
          note: string | null;
          org_id: string;
          paid_at: string;
          pledge_id: string;
          reference: string | null;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        Insert: {
          amount: number;
          channel: Database["public"]["Enums"]["payment_channel"];
          client_ref?: string | null;
          created_at?: string;
          id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          note?: string | null;
          org_id: string;
          paid_at?: string;
          pledge_id: string;
          reference?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount?: number;
          channel?: Database["public"]["Enums"]["payment_channel"];
          client_ref?: string | null;
          created_at?: string;
          id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          note?: string | null;
          org_id?: string;
          paid_at?: string;
          pledge_id?: string;
          reference?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pledge_payments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pledge_payments_pledge_id_fkey";
            columns: ["pledge_id"];
            isOneToOne: false;
            referencedRelation: "pledges";
            referencedColumns: ["id"];
          },
        ];
      };
      pledges: {
        Row: {
          amount: number;
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          contribution_id: string | null;
          created_at: string;
          drive_id: string | null;
          id: string;
          member_id: string | null;
          note: string | null;
          org_id: string;
          pledged_on: string;
          pledger_address: string | null;
          pledger_name: string;
          pledger_phone: string | null;
          promised_by: string | null;
        };
        Insert: {
          amount: number;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          contribution_id?: string | null;
          created_at?: string;
          drive_id?: string | null;
          id?: string;
          member_id?: string | null;
          note?: string | null;
          org_id: string;
          pledged_on?: string;
          pledger_address?: string | null;
          pledger_name: string;
          pledger_phone?: string | null;
          promised_by?: string | null;
        };
        Update: {
          amount?: number;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          contribution_id?: string | null;
          created_at?: string;
          drive_id?: string | null;
          id?: string;
          member_id?: string | null;
          note?: string | null;
          org_id?: string;
          pledged_on?: string;
          pledger_address?: string | null;
          pledger_name?: string;
          pledger_phone?: string | null;
          promised_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pledges_contribution_id_fkey";
            columns: ["contribution_id"];
            isOneToOne: false;
            referencedRelation: "contributions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pledges_drive_id_fkey";
            columns: ["drive_id"];
            isOneToOne: false;
            referencedRelation: "pledge_drives";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pledges_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pledges_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          fiscal_year_start_month: number;
          created_at: string;
          created_by: string;
          id: string;
          logo_url: string | null;
          name: string;
          opening_balance_set: boolean;
        };
        Insert: {
          fiscal_year_start_month?: number;
          created_at?: string;
          created_by: string;
          id?: string;
          logo_url?: string | null;
          name: string;
          opening_balance_set?: boolean;
        };
        Update: {
          fiscal_year_start_month?: number;
          created_at?: string;
          created_by?: string;
          id?: string;
          logo_url?: string | null;
          name?: string;
          opening_balance_set?: boolean;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string;
          id: string;
          must_change_password: boolean;
          org_id: string | null;
          phone: string | null;
        };
        Insert: {
          created_at?: string;
          full_name?: string;
          id: string;
          must_change_password?: boolean;
          org_id?: string | null;
          phone?: string | null;
        };
        Update: {
          created_at?: string;
          full_name?: string;
          id?: string;
          must_change_password?: boolean;
          org_id?: string | null;
          phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          org_id: string | null;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id?: string | null;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      pledge_status: {
        Row: {
          amount: number;
          cancel_reason: string | null;
          cancelled_at: string | null;
          contribution_id: string | null;
          created_at: string;
          drive_id: string | null;
          for_name: string | null;
          id: string;
          last_paid_at: string | null;
          member_id: string | null;
          note: string | null;
          org_id: string;
          outstanding: number;
          pledged_on: string;
          pledger_address: string | null;
          pledger_name: string;
          pledger_phone: string | null;
          promised_by: string | null;
          redeemed: number;
          status: "open" | "part" | "redeemed" | "cancelled";
        };
        Relationships: [];
      };
    };
    Functions: {
      account_deletion_blocker: { Args: never; Returns: string | null };
      analytics_summary: {
        Args: { _branch_id?: string; _from: string; _label?: string; _to: string };
        Returns: Json;
      };
      attach_member: {
        Args: {
          _full_name: string;
          _must_change_password: boolean;
          _org_id: string;
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: undefined;
      };
      channel_totals: { Args: { _from?: string; _to?: string }; Returns: Json };
      contribution_progress: { Args: { _open_only?: boolean }; Returns: Json };
      current_org_id: { Args: never; Returns: string };
      dashboard_summary: { Args: never; Returns: Json };
      ledger_totals: { Args: { _from?: string; _to?: string }; Returns: Json };
      member_balances: {
        Args: { _member_id?: string };
        Returns: {
          contributions_owing: number;
          dues_owing: number;
          member_id: string;
          name: string;
          penalties: number;
          total_owing: number;
        }[];
      };
      report_summary: { Args: { _from: string; _to: string }; Returns: Json };
      standing_lines: {
        Args: { _member_id?: string };
        Returns: {
          expected: number;
          is_current: boolean;
          is_past: boolean;
          kind: string;
          member_id: string;
          paid: number;
          penalty: number;
          period_end: string | null;
          period_label: string | null;
          period_start: string | null;
          ref_id: string;
          ref_name: string;
          short: number;
        }[];
      };
      change_due_amount: {
        Args: { _amount: number; _due_id: string; _from: string };
        Returns: undefined;
      };
      due_member_ids: { Args: { _due_id: string }; Returns: string[] };
      due_period_list: {
        Args: { _due_id: string };
        Returns: {
          expected: number;
          is_current: boolean;
          is_past: boolean;
          label: string;
          period_end: string | null;
          period_start: string;
        }[];
      };
      set_opening_balance: {
        Args: { _as_of?: string; _bank: number; _cash: number };
        Returns: undefined;
      };
      financial_year_of: {
        Args: { _d: string };
        Returns: { ends_on: string; label: string; starts_on: string }[];
      };
      financial_year_summary: { Args: { _any_date?: string }; Returns: Json };
      close_financial_year: { Args: { _any_date: string; _notes?: string }; Returns: undefined };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_org_admin: { Args: never; Returns: boolean };
      is_platform_admin: { Args: never; Returns: boolean };
      is_platform_admin_member: { Args: never; Returns: boolean };
      signed_in_with_two_steps: { Args: never; Returns: boolean };
      in_support_session: { Args: never; Returns: boolean };
      app_context: { Args: never; Returns: Json };
      admin_org_list: {
        Args: { _search?: string };
        Returns: {
          admin_emails: string | null;
          created_at: string;
          id: string;
          last_activity: string | null;
          members: number;
          name: string;
          team: number;
        }[];
      };
      admin_activity: {
        Args: { _limit?: number };
        Returns: {
          action: string;
          admin_email: string | null;
          admin_id: string | null;
          at: string;
          details: Json | null;
          id: number;
          org_id: string | null;
          org_name: string | null;
          reason: string | null;
        }[];
      };
      start_support_session: {
        Args: { _minutes?: number; _org_id: string; _reason: string };
        Returns: {
          admin_id: string;
          ended_at: string | null;
          expires_at: string;
          id: string;
          org_id: string;
          reason: string;
          started_at: string;
        };
      };
      end_support_session: { Args: never; Returns: undefined };
      admin_export_org: { Args: { _org_id: string }; Returns: Json };
      admin_overview: { Args: never; Returns: Json };
      admin_billing_overview: { Args: never; Returns: Json };
      admin_org_billing: { Args: { _org_id: string }; Returns: Json };
      admin_extend_trial: {
        Args: { _days: number; _org_id: string; _reason: string };
        Returns: undefined;
      };
      admin_record_payment: {
        Args: {
          _amount: number;
          _months: number;
          _note: string;
          _org_id: string;
          _reference: string;
        };
        Returns: Json;
      };
      admin_set_free_plan: {
        Args: { _free: boolean; _org_id: string; _reason: string };
        Returns: undefined;
      };
      can_manage_billing: { Args: never; Returns: boolean };
      org_billing_payments: {
        Args: never;
        Returns: {
          amount: number;
          covers_from: string;
          covers_until: string;
          currency: string;
          id: string;
          months: number;
          note: string | null;
          paid_at: string;
          provider: string;
        }[];
      };
      record_subscription_payment: {
        Args: {
          _amount: number;
          _currency: string;
          _months: number;
          _note?: string;
          _org_id: string;
          _paid_at?: string;
          _provider: string;
          _provider_email?: string;
          _provider_ref: string;
          _raw?: Json;
          _recorded_by?: string;
          _subscription_id?: string;
        };
        Returns: Json;
      };
      create_billing_checkout: {
        Args: { _by: string; _email: string; _org_id: string; _tx_ref: string };
        Returns: undefined;
      };
      org_for_checkout: { Args: { _tx_ref: string }; Returns: string | null };
      org_for_payer_email: { Args: { _email: string }; Returns: string | null };
      mark_auto_renew_cancelled: { Args: { _org_id: string }; Returns: undefined };
      admin_orgs: {
        Args: { _limit?: number; _offset?: number; _search?: string; _sort?: string };
        Returns: {
          admin_emails: string | null;
          created_at: string;
          id: string;
          last_activity: string | null;
          members: number;
          name: string;
          team: number;
          billing_status: string | null;
          total_count: number;
        }[];
      };
      admin_org_detail: { Args: { _org_id: string }; Returns: Json };
      admin_org_history: {
        Args: { _limit?: number; _offset?: number; _org_id: string };
        Returns: {
          action: string;
          actor_id: string | null;
          actor_label: string | null;
          at: string;
          id: number;
          new_row: Json | null;
          old_row: Json | null;
          org_id: string;
          row_id: string | null;
          table_name: string;
        }[];
      };
      admin_org_names: { Args: { _org_id: string }; Returns: { id: string; name: string }[] };
      admin_list_admins: {
        Args: never;
        Returns: {
          added_at: string;
          added_by_email: string | null;
          email: string | null;
          full_name: string | null;
          is_you: boolean;
          last_sign_in_at: string | null;
          two_step: boolean;
          user_id: string;
        }[];
      };
      grant_platform_admin: { Args: { _by: string; _user_id: string }; Returns: undefined };
      remove_platform_admin: { Args: { _user_id: string }; Returns: undefined };
      admin_activity_page: {
        Args: {
          _action?: string;
          _admin_id?: string;
          _limit?: number;
          _offset?: number;
          _org_id?: string;
        };
        Returns: {
          action: string;
          admin_email: string | null;
          admin_id: string | null;
          at: string;
          details: Json | null;
          id: number;
          org_id: string | null;
          org_name: string | null;
          reason: string | null;
          total_count: number;
        }[];
      };
      log_platform_action: {
        Args: {
          _action: string;
          _admin_id?: string;
          _details?: Json;
          _org_id: string | null;
          _reason: string | null;
        };
        Returns: undefined;
      };
      wipe_organization: {
        Args: { _admin_id: string; _confirm_name: string; _org_id: string; _reason: string };
        Returns: Json;
      };
      pay_member_debts: {
        Args: {
          _amount: number;
          _channel: Database["public"]["Enums"]["payment_channel"];
          _client_ref?: string;
          _member_id: string;
          _note?: string;
          _paid_at: string;
          _reference?: string;
        };
        Returns: Json;
      };
      post_contribution_expenses: {
        Args: { _contribution_id: string };
        Returns: undefined;
      };
      remove_team_member: { Args: { _user_id: string }; Returns: undefined };
      reverse_ledger_entry: {
        Args: { _entry_id: string; _reason: string };
        Returns: undefined;
      };
      set_member_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"]; _user_id: string };
        Returns: undefined;
      };
      setup_organization: {
        Args: { _full_name: string; _org_name: string; _phone?: string };
        Returns: string;
      };
      user_id_for_email: { Args: { _email: string }; Returns: string | null };
      cancel_pledge: {
        Args: { _pledge_id: string; _reason: string };
        Returns: undefined;
      };
      void_payment: {
        Args: { _kind: string; _payment_id: string; _reason: string };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "viewer";
      due_frequency: "daily" | "weekly" | "monthly" | "yearly" | "custom";
      ledger_kind: "income" | "expense";
      due_audience: "everyone" | "labels" | "branches" | "people";
      payment_method: "cash" | "transfer";
      payment_channel:
        "cash" | "bank_transfer" | "pos" | "ussd" | "mobile_money" | "cheque" | "other";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "viewer"],
      due_frequency: ["daily", "weekly", "monthly", "yearly", "custom"],
      ledger_kind: ["income", "expense"],
      due_audience: ["everyone", "labels", "branches", "people"],
      payment_method: ["cash", "transfer"],
      payment_channel: ["cash", "bank_transfer", "pos", "ussd", "mobile_money", "cheque", "other"],
    },
  },
} as const;
