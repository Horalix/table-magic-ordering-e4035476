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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      bill_requests: {
        Row: {
          created_at: string
          id: string
          resolved_at: string | null
          status: string
          table_session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          resolved_at?: string | null
          status?: string
          table_session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          resolved_at?: string | null
          status?: string
          table_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_requests_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          name: string
          name_ar: string | null
          name_bs: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          name: string
          name_ar?: string | null
          name_bs?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          name?: string
          name_ar?: string | null
          name_bs?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          created_at: string
          description: string | null
          description_ar: string | null
          description_bs: string | null
          id: string
          image_url: string | null
          is_available: boolean
          name: string
          name_ar: string | null
          name_bs: string | null
          price: number
          sort_order: number
          subcategory_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          description_ar?: string | null
          description_bs?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name: string
          name_ar?: string | null
          name_bs?: string | null
          price: number
          sort_order?: number
          subcategory_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          description_ar?: string | null
          description_bs?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name?: string
          name_ar?: string | null
          name_bs?: string | null
          price?: number
          sort_order?: number
          subcategory_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          menu_item_id: string
          notes: string | null
          order_id: string
          quantity: number
          status: Database["public"]["Enums"]["order_item_status"]
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          menu_item_id: string
          notes?: string | null
          order_id: string
          quantity?: number
          status?: Database["public"]["Enums"]["order_item_status"]
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          menu_item_id?: string
          notes?: string | null
          order_id?: string
          quantity?: number
          status?: Database["public"]["Enums"]["order_item_status"]
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_ticket_events: {
        Row: {
          attempts: number
          created_at: string
          destination: string | null
          exported_at: string | null
          format: string
          id: string
          last_error: string | null
          order_id: string
          payload: Json
          printed_at: string | null
          status: string
          ticket_type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          destination?: string | null
          exported_at?: string | null
          format?: string
          id?: string
          last_error?: string | null
          order_id: string
          payload?: Json
          printed_at?: string | null
          status?: string
          ticket_type?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          destination?: string | null
          exported_at?: string | null
          format?: string
          id?: string
          last_error?: string | null
          order_id?: string
          payload?: Json
          printed_at?: string | null
          status?: string
          ticket_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_ticket_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          assigned_waiter_id: string | null
          confirmed_at: string | null
          created_at: string
          guest_name: string | null
          id: string
          notes: string | null
          payment_method: string | null
          payment_status: string
          preparing_at: string | null
          ready_at: string | null
          served_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          table_session_id: string
          total: number
          updated_at: string
        }
        Insert: {
          assigned_waiter_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          guest_name?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          preparing_at?: string | null
          ready_at?: string | null
          served_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_session_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          assigned_waiter_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          guest_name?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          preparing_at?: string | null
          ready_at?: string | null
          served_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_session_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_assigned_waiter_id_fkey"
            columns: ["assigned_waiter_id"]
            isOneToOne: false
            referencedRelation: "waiters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          id: string
          monri_order_number: string
          monri_payment_id: string | null
          order_id: string
          provider: string
          provider_payload: Json
          status: string
          transaction_type: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency?: string
          id?: string
          monri_order_number: string
          monri_payment_id?: string | null
          order_id: string
          provider?: string
          provider_payload?: Json
          status?: string
          transaction_type?: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          id?: string
          monri_order_number?: string
          monri_payment_id?: string | null
          order_id?: string
          provider?: string
          provider_payload?: Json
          status?: string
          transaction_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ratings: {
        Row: {
          created_at: string
          id: string
          rating: number
          table_session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          rating: number
          table_session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          rating?: number
          table_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      section_assignments: {
        Row: {
          created_at: string
          id: string
          section_id: string
          shift_date: string
          waiter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          section_id: string
          shift_date?: string
          waiter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          section_id?: string
          shift_date?: string
          waiter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "section_assignments_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_assignments_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "waiters"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      server_ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          rating: number
          table_session_id: string
          waiter_id: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          table_session_id: string
          waiter_id?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          table_session_id?: string
          waiter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "server_ratings_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_ratings_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "waiters"
            referencedColumns: ["id"]
          },
        ]
      }
      session_join_requests: {
        Row: {
          client_id: string
          created_at: string
          guest_name: string
          id: string
          resolved_at: string | null
          resolved_by_name: string | null
          status: string
          table_session_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          guest_name: string
          id?: string
          resolved_at?: string | null
          resolved_by_name?: string | null
          status?: string
          table_session_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          guest_name?: string
          id?: string
          resolved_at?: string | null
          resolved_by_name?: string | null
          status?: string
          table_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_join_requests_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      subcategories: {
        Row: {
          category_id: string
          created_at: string
          id: string
          name: string
          name_ar: string | null
          name_bs: string | null
          sort_order: number
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          name: string
          name_ar?: string | null
          name_bs?: string | null
          sort_order?: number
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          name?: string
          name_ar?: string | null
          name_bs?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      table_sessions: {
        Row: {
          assigned_waiter_id: string | null
          closed_at: string | null
          first_order_at: string | null
          guest_name: string | null
          host_client_id: string | null
          id: string
          is_active: boolean
          last_heartbeat_at: string
          last_served_at: string | null
          opened_at: string
          table_id: string
          token: string
        }
        Insert: {
          assigned_waiter_id?: string | null
          closed_at?: string | null
          first_order_at?: string | null
          guest_name?: string | null
          host_client_id?: string | null
          id?: string
          is_active?: boolean
          last_heartbeat_at?: string
          last_served_at?: string | null
          opened_at?: string
          table_id: string
          token?: string
        }
        Update: {
          assigned_waiter_id?: string | null
          closed_at?: string | null
          first_order_at?: string | null
          guest_name?: string | null
          host_client_id?: string | null
          id?: string
          is_active?: boolean
          last_heartbeat_at?: string
          last_served_at?: string | null
          opened_at?: string
          table_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_assigned_waiter_id_fkey"
            columns: ["assigned_waiter_id"]
            isOneToOne: false
            referencedRelation: "waiters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          created_at: string
          id: string
          qr_token: string
          section_id: string | null
          status: Database["public"]["Enums"]["table_status"]
          table_number: number
        }
        Insert: {
          created_at?: string
          id?: string
          qr_token?: string
          section_id?: string | null
          status?: Database["public"]["Enums"]["table_status"]
          table_number: number
        }
        Update: {
          created_at?: string
          id?: string
          qr_token?: string
          section_id?: string | null
          status?: Database["public"]["Enums"]["table_status"]
          table_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "tables_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waiter_calls: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          resolved_at: string | null
          status: string
          table_session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          resolved_at?: string | null
          status?: string
          table_session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          resolved_at?: string | null
          status?: string
          table_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiter_calls_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      waiters: {
        Row: {
          created_at: string
          display_name: string
          has_pin: boolean | null
          id: string
          is_active: boolean
          pin_hash: string | null
          pin_set_at: string | null
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          has_pin?: boolean | null
          id?: string
          is_active?: boolean
          pin_hash?: string | null
          pin_set_at?: string | null
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          has_pin?: boolean | null
          id?: string
          is_active?: boolean
          pin_hash?: string | null
          pin_set_at?: string | null
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_set_waiter_pin: {
        Args: { _pin: string; _waiter_id: string }
        Returns: undefined
      }
      assert_guest_session: {
        Args: { _session_id: string; _session_token: string }
        Returns: {
          assigned_waiter_id: string | null
          closed_at: string | null
          first_order_at: string | null
          guest_name: string | null
          host_client_id: string | null
          id: string
          is_active: boolean
          last_heartbeat_at: string
          last_served_at: string | null
          opened_at: string
          table_id: string
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "table_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_order_ticket: {
        Args: { _order_id: string; _ticket_type?: string }
        Returns: string
      }
      get_popular_items: {
        Args: { _days?: number; _limit?: number }
        Returns: {
          menu_item_id: string
          qty: number
        }[]
      }
      get_waiter_id: { Args: { _user_id: string }; Returns: string }
      guest_auto_approve_join_request: {
        Args: {
          _client_id: string
          _qr_token: string
          _request_id: string
          _session_id: string
          _table_number: number
        }
        Returns: Json
      }
      guest_call_waiter: {
        Args: { _reason?: string; _session_id: string; _session_token: string }
        Returns: Json
      }
      guest_get_join_request: {
        Args: { _client_id: string; _request_id: string; _session_id: string }
        Returns: Json
      }
      guest_get_tab: {
        Args: { _session_id: string; _session_token: string }
        Returns: Json
      }
      guest_get_waiter_for_review: {
        Args: { _session_id: string; _session_token: string }
        Returns: Json
      }
      guest_inspect_table: {
        Args: { _client_id: string; _qr_token: string; _table_number: number }
        Returns: Json
      }
      guest_list_pending_join_requests: {
        Args: {
          _client_id: string
          _session_id: string
          _session_token: string
        }
        Returns: {
          client_id: string
          created_at: string
          guest_name: string
          id: string
          status: string
        }[]
      }
      guest_place_order: {
        Args: {
          _guest_name: string
          _items: Json
          _payment_method: string
          _session_id: string
          _session_token: string
        }
        Returns: Json
      }
      guest_request_bill: {
        Args: { _session_id: string; _session_token: string }
        Returns: Json
      }
      guest_request_join: {
        Args: {
          _client_id: string
          _guest_name: string
          _qr_token: string
          _table_number: number
        }
        Returns: Json
      }
      guest_resolve_join_request: {
        Args: {
          _request_id: string
          _resolved_by_name: string
          _session_id: string
          _session_token: string
          _status: string
        }
        Returns: Json
      }
      guest_start_table_session: {
        Args: {
          _client_id: string
          _guest_name: string
          _qr_token: string
          _table_number: number
        }
        Returns: Json
      }
      guest_submit_server_rating: {
        Args: {
          _comment?: string
          _rating: number
          _session_id: string
          _session_token: string
          _waiter_id: string
        }
        Returns: Json
      }
      guest_submit_visit_rating: {
        Args: { _rating: number; _session_id: string; _session_token: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff_member: { Args: never; Returns: boolean }
      touch_session: { Args: { _id: string; _token: string }; Returns: boolean }
      verify_waiter_pin: {
        Args: { _pin: string; _waiter_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "staff"
      order_item_status: "pending" | "preparing" | "ready" | "served"
      order_status:
        | "pending"
        | "confirmed"
        | "preparing"
        | "ready"
        | "served"
        | "cancelled"
      table_status: "available" | "occupied" | "reserved"
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
      app_role: ["admin", "staff"],
      order_item_status: ["pending", "preparing", "ready", "served"],
      order_status: [
        "pending",
        "confirmed",
        "preparing",
        "ready",
        "served",
        "cancelled",
      ],
      table_status: ["available", "occupied", "reserved"],
    },
  },
} as const
