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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          id: string
          patient_id: string
          scheduled_date: string
          scheduled_time: string
          service_id: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          id?: string
          patient_id: string
          scheduled_date: string
          scheduled_time: string
          service_id: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          id?: string
          patient_id?: string
          scheduled_date?: string
          scheduled_time?: string
          service_id?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_settings: {
        Row: {
          capacity_threshold: number
          clinic_id: string
          confidence_consistent_stddev_minutes: number
          confidence_high_min_count: number
          confidence_inconsistent_stddev_minutes: number
          confidence_min_count_floor: number
          long_consultation_multiplier: number
          max_plausible_consultation_minutes: number
          min_booking_lead_minutes: number
          min_plausible_consultation_minutes: number
          no_show_grace_minutes: number
          undo_window_seconds: number
          updated_at: string
        }
        Insert: {
          capacity_threshold?: number
          clinic_id: string
          confidence_consistent_stddev_minutes?: number
          confidence_high_min_count?: number
          confidence_inconsistent_stddev_minutes?: number
          confidence_min_count_floor?: number
          long_consultation_multiplier?: number
          max_plausible_consultation_minutes?: number
          min_booking_lead_minutes?: number
          min_plausible_consultation_minutes?: number
          no_show_grace_minutes?: number
          undo_window_seconds?: number
          updated_at?: string
        }
        Update: {
          capacity_threshold?: number
          clinic_id?: string
          confidence_consistent_stddev_minutes?: number
          confidence_high_min_count?: number
          confidence_inconsistent_stddev_minutes?: number
          confidence_min_count_floor?: number
          long_consultation_multiplier?: number
          max_plausible_consultation_minutes?: number
          min_booking_lead_minutes?: number
          min_plausible_consultation_minutes?: number
          no_show_grace_minutes?: number
          undo_window_seconds?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_settings_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      consultations: {
        Row: {
          created_at: string
          ended_at: string | null
          exclude_from_prediction: boolean
          exclusion_reason: string | null
          id: string
          nurse_id: string
          queue_entry_id: string
          service_id: string
          started_at: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          exclude_from_prediction?: boolean
          exclusion_reason?: string | null
          id?: string
          nurse_id: string
          queue_entry_id: string
          service_id: string
          started_at?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          exclude_from_prediction?: boolean
          exclusion_reason?: string | null
          id?: string
          nurse_id?: string
          queue_entry_id?: string
          service_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultations_nurse_id_fkey"
            columns: ["nurse_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_queue_entry_id_fkey"
            columns: ["queue_entry_id"]
            isOneToOne: true
            referencedRelation: "queue_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          appointment_id: string | null
          body: string | null
          created_at: string
          id: string
          kind: string
          queue_entry_id: string | null
          read_at: string | null
          recipient_id: string
          title: string
        }
        Insert: {
          appointment_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          queue_entry_id?: string | null
          read_at?: string | null
          recipient_id: string
          title: string
        }
        Update: {
          appointment_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          queue_entry_id?: string | null
          read_at?: string | null
          recipient_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_queue_entry_id_fkey"
            columns: ["queue_entry_id"]
            isOneToOne: false
            referencedRelation: "queue_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      nurse_actions: {
        Row: {
          action_id: string
          created_at: string
          id: string
          nurse_id: string
          result: Json
          undone_at: string | null
        }
        Insert: {
          action_id: string
          created_at?: string
          id?: string
          nurse_id: string
          result: Json
          undone_at?: string | null
        }
        Update: {
          action_id?: string
          created_at?: string
          id?: string
          nurse_id?: string
          result?: Json
          undone_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nurse_actions_nurse_id_fkey"
            columns: ["nurse_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_user_id: string | null
          clinic_id: string | null
          created_at: string
          current_service_id: string | null
          full_name: string
          id: string
          is_active: boolean
          is_on_duty: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          clinic_id?: string | null
          created_at?: string
          current_service_id?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          is_on_duty?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          clinic_id?: string | null
          created_at?: string
          current_service_id?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          is_on_duty?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_current_service_id_fkey"
            columns: ["current_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      queue_entries: {
        Row: {
          appointment_id: string | null
          called_at: string | null
          checked_in_at: string
          clinic_id: string
          completed_at: string | null
          created_at: string
          id: string
          patient_id: string
          priority: number
          priority_set_at: string | null
          priority_set_by: string | null
          queue_date: string
          service_id: string
          status: Database["public"]["Enums"]["queue_entry_status"]
          token: string
          token_number: number
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          called_at?: string | null
          checked_in_at?: string
          clinic_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          patient_id: string
          priority?: number
          priority_set_at?: string | null
          priority_set_by?: string | null
          queue_date?: string
          service_id: string
          status?: Database["public"]["Enums"]["queue_entry_status"]
          token: string
          token_number: number
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          called_at?: string | null
          checked_in_at?: string
          clinic_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          patient_id?: string
          priority?: number
          priority_set_at?: string | null
          priority_set_by?: string | null
          queue_date?: string
          service_id?: string
          status?: Database["public"]["Enums"]["queue_entry_status"]
          token?: string
          token_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_entries_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_priority_set_by_fkey"
            columns: ["priority_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      queue_events: {
        Row: {
          clinic_id: string
          created_at: string
          id: number
          service_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: number
          service_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: number
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_events_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_events_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          clinic_id: string
          created_at: string
          default_consultation_minutes: number
          id: string
          is_active: boolean
          name: string
          token_prefix: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          default_consultation_minutes?: number
          id?: string
          is_active?: boolean
          name: string
          token_prefix: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          default_consultation_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          token_prefix?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_set_staff_status: {
        Args: {
          p_is_active?: boolean
          p_profile_id: string
          p_role?: Database["public"]["Enums"]["user_role"]
        }
        Returns: {
          auth_user_id: string | null
          clinic_id: string | null
          created_at: string
          current_service_id: string | null
          full_name: string
          id: string
          is_active: boolean
          is_on_duty: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      auth_clinic_id: { Args: never; Returns: string }
      auth_profile_id: { Args: never; Returns: string }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      available_nurses: { Args: { p_service_id: string }; Returns: number }
      book_appointment: {
        Args: { p_patient_id?: string; p_service_id: string; p_slot: string }
        Returns: {
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          id: string
          patient_id: string
          scheduled_date: string
          scheduled_time: string
          service_id: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      call_next_patient: {
        Args: never
        Returns: {
          appointment_id: string | null
          called_at: string | null
          checked_in_at: string
          clinic_id: string
          completed_at: string | null
          created_at: string
          id: string
          patient_id: string
          priority: number
          priority_set_at: string | null
          priority_set_by: string | null
          queue_date: string
          service_id: string
          status: Database["public"]["Enums"]["queue_entry_status"]
          token: string
          token_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "queue_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      can_subscribe_queue_topic: { Args: { p_topic: string }; Returns: boolean }
      cancel_appointment: {
        Args: { p_appointment_id: string }
        Returns: {
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          id: string
          patient_id: string
          scheduled_date: string
          scheduled_time: string
          service_id: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_in_appointment: {
        Args: { p_appointment_id: string }
        Returns: {
          appointment_id: string | null
          called_at: string | null
          checked_in_at: string
          clinic_id: string
          completed_at: string | null
          created_at: string
          id: string
          patient_id: string
          priority: number
          priority_set_at: string | null
          priority_set_by: string | null
          queue_date: string
          service_id: string
          status: Database["public"]["Enums"]["queue_entry_status"]
          token: string
          token_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "queue_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_in_patient: {
        Args: {
          p_patient_id: string
          p_priority?: number
          p_service_id: string
        }
        Returns: {
          appointment_id: string | null
          called_at: string | null
          checked_in_at: string
          clinic_id: string
          completed_at: string | null
          created_at: string
          id: string
          patient_id: string
          priority: number
          priority_set_at: string | null
          priority_set_by: string | null
          queue_date: string
          service_id: string
          status: Database["public"]["Enums"]["queue_entry_status"]
          token: string
          token_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "queue_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confidence_label: {
        Args: { p_count: number; p_service_id: string; p_stddev: number }
        Returns: string
      }
      create_walkin_patient: {
        Args: { p_full_name: string; p_phone?: string }
        Returns: {
          auth_user_id: string | null
          clinic_id: string | null
          created_at: string
          current_service_id: string | null
          full_name: string
          id: string
          is_active: boolean
          is_on_duty: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      end_consultation: {
        Args: { p_queue_entry_id: string }
        Returns: {
          consultation_id: string
          duration_minutes: number
          new_confidence: string
          new_service_average: number
        }[]
      }
      find_duplicate_patients: {
        Args: never
        Returns: {
          has_login_a: boolean
          has_login_b: boolean
          history_a: number
          history_b: number
          match_reason: string
          name_a: string
          name_b: string
          phone_a: string
          phone_b: string
          profile_a: string
          profile_b: string
        }[]
      }
      get_available_slots: {
        Args: {
          p_close?: string
          p_date: string
          p_open?: string
          p_service_id: string
          p_step_mins?: number
        }
        Returns: {
          is_taken: boolean
          slot_time: string
        }[]
      }
      get_service_queue: {
        Args: { p_service_id: string }
        Returns: {
          checked_in_at: string
          patient_name: string
          priority: number
          queue_entry_id: string
          queue_position: number
          status: Database["public"]["Enums"]["queue_entry_status"]
          token: string
          waiting_minutes: number
        }[]
      }
      get_wait_estimate: {
        Args: { p_queue_entry_id: string }
        Returns: {
          confidence: string
          estimated_wait_minutes: number
          queue_position: number
          service_name: string
          status: string
          token: string
        }[]
      }
      mark_notifications_read: { Args: { p_ids: string[] }; Returns: number }
      mark_overdue_no_shows: {
        Args: never
        Returns: {
          marked_count: number
          marked_ids: string[]
        }[]
      }
      merge_patient_profiles: {
        Args: { p_keep_id: string; p_merge_id: string }
        Returns: {
          appointments_moved: number
          audit_refs_moved: number
          notifications_moved: number
          queue_entries_moved: number
        }[]
      }
      next_patient: {
        Args: { p_action_id: string; p_long_decision?: string }
        Returns: Json
      }
      nth_waiting_entry: {
        Args: { p_n: number; p_service_id: string }
        Returns: {
          appointment_id: string | null
          called_at: string | null
          checked_in_at: string
          clinic_id: string
          completed_at: string | null
          created_at: string
          id: string
          patient_id: string
          priority: number
          priority_set_at: string | null
          priority_set_by: string | null
          queue_date: string
          service_id: string
          status: Database["public"]["Enums"]["queue_entry_status"]
          token: string
          token_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "queue_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prune_queue_events: { Args: never; Returns: undefined }
      search_patients: {
        Args: { p_query: string }
        Returns: {
          full_name: string
          has_account: boolean
          id: string
          phone: string
        }[]
      }
      service_consultation_stats: {
        Args: { p_service_id: string }
        Returns: {
          avg_minutes: number
          sample_count: number
          stddev_minutes: number
        }[]
      }
      set_duty: {
        Args: { p_on_duty: boolean; p_service_id?: string }
        Returns: {
          auth_user_id: string | null
          clinic_id: string | null
          created_at: string
          current_service_id: string | null
          full_name: string
          id: string
          is_active: boolean
          is_on_duty: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_emergency_priority: {
        Args: { p_emergency: boolean; p_queue_entry_id: string }
        Returns: {
          appointment_id: string | null
          called_at: string | null
          checked_in_at: string
          clinic_id: string
          completed_at: string | null
          created_at: string
          id: string
          patient_id: string
          priority: number
          priority_set_at: string | null
          priority_set_by: string | null
          queue_date: string
          service_id: string
          status: Database["public"]["Enums"]["queue_entry_status"]
          token: string
          token_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "queue_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      skip_patient: {
        Args: { p_no_show?: boolean; p_queue_entry_id: string }
        Returns: {
          appointment_id: string | null
          called_at: string | null
          checked_in_at: string
          clinic_id: string
          completed_at: string | null
          created_at: string
          id: string
          patient_id: string
          priority: number
          priority_set_at: string | null
          priority_set_by: string | null
          queue_date: string
          service_id: string
          status: Database["public"]["Enums"]["queue_entry_status"]
          token: string
          token_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "queue_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_consultation: {
        Args: { p_queue_entry_id: string }
        Returns: {
          created_at: string
          ended_at: string | null
          exclude_from_prediction: boolean
          exclusion_reason: string | null
          id: string
          nurse_id: string
          queue_entry_id: string
          service_id: string
          started_at: string
        }
        SetofOptions: {
          from: "*"
          to: "consultations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      system_health_check: {
        Args: never
        Returns: {
          category: string
          check_name: string
          detail: string
          status: string
        }[]
      }
      undo_next_patient: { Args: { p_action_id: string }; Returns: Json }
    }
    Enums: {
      appointment_status:
        | "booked"
        | "checked_in"
        | "cancelled"
        | "no_show"
        | "completed"
      queue_entry_status:
        | "waiting"
        | "in_progress"
        | "done"
        | "skipped"
        | "no_show"
      user_role: "patient" | "receptionist" | "nurse" | "admin"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      appointment_status: [
        "booked",
        "checked_in",
        "cancelled",
        "no_show",
        "completed",
      ],
      queue_entry_status: [
        "waiting",
        "in_progress",
        "done",
        "skipped",
        "no_show",
      ],
      user_role: ["patient", "receptionist", "nurse", "admin"],
    },
  },
} as const

// Convenience aliases used across the app.
export type Profile = Database["public"]["Tables"]["profiles"]["Row"]
export type UserRole = Database["public"]["Enums"]["user_role"]
export type QueueEntry = Database["public"]["Tables"]["queue_entries"]["Row"]
export type QueueEntryStatus = Database["public"]["Enums"]["queue_entry_status"]
export type WaitEstimate = Database["public"]["Functions"]["get_wait_estimate"]["Returns"][number]
export type Appointment = Database["public"]["Tables"]["appointments"]["Row"]
export type AppointmentStatus = Database["public"]["Enums"]["appointment_status"]
export type Notification = Database["public"]["Tables"]["notifications"]["Row"]
/** notifications.kind is a plain text column with a CHECK constraint, not a Postgres enum, so this union is hand-maintained rather than generated — keep it in sync with migration 0023. */
export type NotificationKind =
  | "queue_position"
  | "you_are_next"
  | "called"
  | "appointment_reminder"
  | "appointment_cancelled"
  | "emergency_ahead"
