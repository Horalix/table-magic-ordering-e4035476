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
      categories: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          name: string
          name_bs: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          name: string
          name_bs?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          name?: string
          name_bs?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          created_at: string
          description: string | null
          description_bs: string | null
          id: string
          image_url: string | null
          is_available: boolean
          name: string
          name_bs: string | null
          price: number
          sort_order: number
          subcategory_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          description_bs?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name: string
          name_bs?: string | null
          price: number
          sort_order?: number
          subcategory_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          description_bs?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name?: string
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
      orders: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["order_status"]
          table_session_id: string
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_session_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_session_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_table_session_id_fkey"
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
          name_bs: string | null
          sort_order: number
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          name: string
          name_bs?: string | null
          sort_order?: number
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          name?: string
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
          closed_at: string | null
          id: string
          is_active: boolean
          opened_at: string
          table_id: string
          token: string
        }
        Insert: {
          closed_at?: string | null
          id?: string
          is_active?: boolean
          opened_at?: string
          table_id: string
          token?: string
        }
        Update: {
          closed_at?: string | null
          id?: string
          is_active?: boolean
          opened_at?: string
          table_id?: string
          token?: string
        }
        Relationships: [
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
          status: Database["public"]["Enums"]["table_status"]
          table_number: number
        }
        Insert: {
          created_at?: string
          id?: string
          qr_token?: string
          status?: Database["public"]["Enums"]["table_status"]
          table_number: number
        }
        Update: {
          created_at?: string
          id?: string
          qr_token?: string
          status?: Database["public"]["Enums"]["table_status"]
          table_number?: number
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
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
