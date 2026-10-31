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
      analytics_events: {
        Row: {
          created_at: string
          event: string
          id: number
          occurred_at: string
          props: Json
          venue_id: string | null
          visit_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: number
          occurred_at?: string
          props?: Json
          venue_id?: string | null
          visit_id: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: number
          occurred_at?: string
          props?: Json
          venue_id?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_label: string | null
          actor_user_id: string | null
          after_state: Json | null
          before_state: Json | null
          correlation_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          reason: string | null
          venue_id: string | null
        }
        Insert: {
          action: string
          actor_label?: string | null
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          reason?: string | null
          venue_id?: string | null
        }
        Update: {
          action?: string
          actor_label?: string | null
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          reason?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_requests: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          table_session_id: string
          venue_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          table_session_id: string
          venue_id?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          table_session_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_requests_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "session_outcomes"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "bill_requests_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          name: string
          name_ar?: string | null
          name_bs?: string | null
          sort_order?: number
          venue_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          name?: string
          name_ar?: string | null
          name_bs?: string | null
          sort_order?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          created_at: string
          ended_at: string | null
          holdout_pct: number
          id: string
          name: string
          notes: string | null
          policy_version: string
          started_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          holdout_pct: number
          id?: string
          name: string
          notes?: string | null
          policy_version: string
          started_at?: string
          venue_id?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          holdout_pct?: number
          id?: string
          name?: string
          notes?: string | null
          policy_version?: string
          started_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiments_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_profiles: {
        Row: {
          client_id: string
          computed_at: string
          first_seen: string
          last_seen: string
          net_spend: number
          orders: number
          visits: number
        }
        Insert: {
          client_id: string
          computed_at?: string
          first_seen: string
          last_seen: string
          net_spend?: number
          orders?: number
          visits?: number
        }
        Update: {
          client_id?: string
          computed_at?: string
          first_seen?: string
          last_seen?: string
          net_spend?: number
          orders?: number
          visits?: number
        }
        Relationships: []
      }
      item_section_share: {
        Row: {
          computed_at: string
          daypart: string | null
          item_id: string
          share: number
          subcategory_id: string
        }
        Insert: {
          computed_at?: string
          daypart?: string | null
          item_id: string
          share: number
          subcategory_id: string
        }
        Update: {
          computed_at?: string
          daypart?: string | null
          item_id?: string
          share?: number
          subcategory_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_section_share_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_section_share_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_runs: {
        Row: {
          job: string
          last_result: Json
          last_run_at: string
        }
        Insert: {
          job: string
          last_result?: Json
          last_run_at?: string
        }
        Update: {
          job?: string
          last_result?: Json
          last_run_at?: string
        }
        Relationships: []
      }
      menu_combo_options: {
        Row: {
          item_id: string
          slot_id: string
          sort_order: number
          surcharge: number
          venue_id: string
        }
        Insert: {
          item_id: string
          slot_id: string
          sort_order?: number
          surcharge?: number
          venue_id?: string
        }
        Update: {
          item_id?: string
          slot_id?: string
          sort_order?: number
          surcharge?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_combo_options_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_combo_options_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "menu_combo_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_combo_options_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_combo_slots: {
        Row: {
          combo_item_id: string
          created_at: string
          id: string
          label: string
          label_ar: string | null
          label_bs: string | null
          sort_order: number
          venue_id: string
        }
        Insert: {
          combo_item_id: string
          created_at?: string
          id?: string
          label: string
          label_ar?: string | null
          label_bs?: string | null
          sort_order?: number
          venue_id?: string
        }
        Update: {
          combo_item_id?: string
          created_at?: string
          id?: string
          label?: string
          label_ar?: string | null
          label_bs?: string | null
          sort_order?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_combo_slots_combo_item_id_fkey"
            columns: ["combo_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_combo_slots_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_affinity: {
        Row: {
          a_orders: number
          computed_at: string
          confidence: number
          eb_mean: number | null
          eb05: number | null
          item_a: string
          item_b: string
          lift: number
          pair_orders: number
          w_expected: number | null
          w_pair: number | null
        }
        Insert: {
          a_orders?: number
          computed_at?: string
          confidence?: number
          eb_mean?: number | null
          eb05?: number | null
          item_a: string
          item_b: string
          lift?: number
          pair_orders?: number
          w_expected?: number | null
          w_pair?: number | null
        }
        Update: {
          a_orders?: number
          computed_at?: string
          confidence?: number
          eb_mean?: number | null
          eb05?: number | null
          item_a?: string
          item_b?: string
          lift?: number
          pair_orders?: number
          w_expected?: number | null
          w_pair?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_affinity_item_a_fkey"
            columns: ["item_a"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_affinity_item_b_fkey"
            columns: ["item_b"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_availability_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: number
          is_available: boolean
          menu_item_id: string
          venue_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: number
          is_available: boolean
          menu_item_id: string
          venue_id?: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: number
          is_available?: boolean
          menu_item_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_availability_log_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_availability_log_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_prep_stats: {
        Row: {
          computed_at: string
          median_minutes: number | null
          menu_item_id: string
          p80_minutes: number | null
          samples: number
        }
        Insert: {
          computed_at?: string
          median_minutes?: number | null
          menu_item_id: string
          p80_minutes?: number | null
          samples?: number
        }
        Update: {
          computed_at?: string
          median_minutes?: number | null
          menu_item_id?: string
          p80_minutes?: number | null
          samples?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_prep_stats_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: true
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_recommendations: {
        Row: {
          created_at: string
          enabled: boolean
          end_time: string | null
          id: string
          language: string | null
          priority: number
          recommendation_type: string
          recommended_item_id: string
          source_item_id: string | null
          source_subcategory_id: string | null
          start_time: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          end_time?: string | null
          id?: string
          language?: string | null
          priority?: number
          recommendation_type?: string
          recommended_item_id: string
          source_item_id?: string | null
          source_subcategory_id?: string | null
          start_time?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          end_time?: string | null
          id?: string
          language?: string | null
          priority?: number
          recommendation_type?: string
          recommended_item_id?: string
          source_item_id?: string | null
          source_subcategory_id?: string | null
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_recommendations_recommended_item_id_fkey"
            columns: ["recommended_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_recommendations_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_recommendations_source_subcategory_id_fkey"
            columns: ["source_subcategory_id"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          allergens: string[]
          available_from: string | null
          available_to: string | null
          created_at: string
          description: string | null
          description_ar: string | null
          description_bs: string | null
          dietary_tags: string[]
          featured_note: string | null
          featured_note_ar: string | null
          featured_note_bs: string | null
          featured_rank: number | null
          food_cost: number | null
          id: string
          image_url: string | null
          is_available: boolean
          margin_score: number
          meal_role: Database["public"]["Enums"]["meal_role"] | null
          merchandising_tags: string[]
          name: string
          name_ar: string | null
          name_bs: string | null
          new_until: string | null
          portion_note: string | null
          prep_minutes: number | null
          price: number
          sale_ends_at: string | null
          sale_kind: string | null
          sale_label: string | null
          sale_starts_at: string | null
          sale_value: number | null
          sort_order: number
          station: string
          subcategory_id: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          allergens?: string[]
          available_from?: string | null
          available_to?: string | null
          created_at?: string
          description?: string | null
          description_ar?: string | null
          description_bs?: string | null
          dietary_tags?: string[]
          featured_note?: string | null
          featured_note_ar?: string | null
          featured_note_bs?: string | null
          featured_rank?: number | null
          food_cost?: number | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          margin_score?: number
          meal_role?: Database["public"]["Enums"]["meal_role"] | null
          merchandising_tags?: string[]
          name: string
          name_ar?: string | null
          name_bs?: string | null
          new_until?: string | null
          portion_note?: string | null
          prep_minutes?: number | null
          price: number
          sale_ends_at?: string | null
          sale_kind?: string | null
          sale_label?: string | null
          sale_starts_at?: string | null
          sale_value?: number | null
          sort_order?: number
          station?: string
          subcategory_id: string
          updated_at?: string
          venue_id?: string
        }
        Update: {
          allergens?: string[]
          available_from?: string | null
          available_to?: string | null
          created_at?: string
          description?: string | null
          description_ar?: string | null
          description_bs?: string | null
          dietary_tags?: string[]
          featured_note?: string | null
          featured_note_ar?: string | null
          featured_note_bs?: string | null
          featured_rank?: number | null
          food_cost?: number | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          margin_score?: number
          meal_role?: Database["public"]["Enums"]["meal_role"] | null
          merchandising_tags?: string[]
          name?: string
          name_ar?: string | null
          name_bs?: string | null
          new_until?: string | null
          portion_note?: string | null
          prep_minutes?: number | null
          price?: number
          sale_ends_at?: string | null
          sale_kind?: string | null
          sale_label?: string | null
          sale_starts_at?: string | null
          sale_value?: number | null
          sort_order?: number
          station?: string
          subcategory_id?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_machine_translations: {
        Row: {
          field: string
          produced_at: string
          row_id: string
          source_table: string
          value: string
        }
        Insert: {
          field: string
          produced_at?: string
          row_id: string
          source_table: string
          value: string
        }
        Update: {
          field?: string
          produced_at?: string
          row_id?: string
          source_table?: string
          value?: string
        }
        Relationships: []
      }
      order_code_counters: {
        Row: {
          day: string
          last_value: number
          venue_id: string
        }
        Insert: {
          day: string
          last_value?: number
          venue_id?: string
        }
        Update: {
          day?: string
          last_value?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_code_counters_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          bumped_by: string | null
          components: Json | null
          created_at: string
          id: string
          menu_item_id: string
          notes: string | null
          order_id: string
          quantity: number
          ready_at: string | null
          regular_unit_price: number | null
          served_at: string | null
          started_at: string | null
          station: string
          status: Database["public"]["Enums"]["order_item_status"]
          unit_price: number
          venue_id: string
        }
        Insert: {
          bumped_by?: string | null
          components?: Json | null
          created_at?: string
          id?: string
          menu_item_id: string
          notes?: string | null
          order_id: string
          quantity?: number
          ready_at?: string | null
          regular_unit_price?: number | null
          served_at?: string | null
          started_at?: string | null
          station?: string
          status?: Database["public"]["Enums"]["order_item_status"]
          unit_price: number
          venue_id?: string
        }
        Update: {
          bumped_by?: string | null
          components?: Json | null
          created_at?: string
          id?: string
          menu_item_id?: string
          notes?: string | null
          order_id?: string
          quantity?: number
          ready_at?: string | null
          regular_unit_price?: number | null
          served_at?: string | null
          started_at?: string | null
          station?: string
          status?: Database["public"]["Enums"]["order_item_status"]
          unit_price?: number
          venue_id?: string
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
            referencedRelation: "completed_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      order_refunds: {
        Row: {
          amount: number
          completed_at: string | null
          completed_by: string | null
          created_at: string
          failure_reason: string | null
          id: string
          method: string
          order_id: string
          payment_transaction_id: string | null
          provider_reference: string | null
          reason: string
          requested_by: string | null
          status: string
          venue_id: string
        }
        Insert: {
          amount: number
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          method: string
          order_id: string
          payment_transaction_id?: string | null
          provider_reference?: string | null
          reason: string
          requested_by?: string | null
          status?: string
          venue_id?: string
        }
        Update: {
          amount?: number
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          method?: string
          order_id?: string
          payment_transaction_id?: string | null
          provider_reference?: string | null
          reason?: string
          requested_by?: string | null
          status?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "completed_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_refunds_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_refunds_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      order_ticket_events: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by_device: string | null
          created_at: string
          destination: string | null
          exported_at: string | null
          format: string
          id: string
          last_error: string | null
          order_id: string
          original_printed_at: string | null
          payload: Json
          print_verified: boolean | null
          printed_at: string | null
          status: string
          ticket_type: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by_device?: string | null
          created_at?: string
          destination?: string | null
          exported_at?: string | null
          format?: string
          id?: string
          last_error?: string | null
          order_id: string
          original_printed_at?: string | null
          payload?: Json
          print_verified?: boolean | null
          printed_at?: string | null
          status?: string
          ticket_type?: string
          updated_at?: string
          venue_id?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by_device?: string | null
          created_at?: string
          destination?: string | null
          exported_at?: string | null
          format?: string
          id?: string
          last_error?: string | null
          order_id?: string
          original_printed_at?: string | null
          payload?: Json
          print_verified?: boolean | null
          printed_at?: string | null
          status?: string
          ticket_type?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_ticket_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "completed_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_ticket_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_ticket_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          assigned_waiter_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_order_id: string | null
          confirmed_at: string | null
          created_at: string
          fiscal_provider_reference: string | null
          fiscal_receipt_number: string | null
          fiscalization_error: string | null
          fiscalization_status: string
          fiscalized: boolean
          fiscalized_at: string | null
          fiscalized_by: string | null
          guest_name: string | null
          held_at: string | null
          held_reason: string | null
          id: string
          notes: string | null
          order_code: string | null
          paid_at: string | null
          paid_by: string | null
          payment_method: string | null
          payment_note: string | null
          payment_status: string
          preparing_at: string | null
          ready_at: string | null
          reco_holdout: boolean | null
          refunded_amount: number
          released_to_kitchen_at: string | null
          served_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          table_session_id: string
          tip_amount: number
          total: number
          updated_at: string
          venue_id: string
        }
        Insert: {
          assigned_waiter_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_order_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          fiscal_provider_reference?: string | null
          fiscal_receipt_number?: string | null
          fiscalization_error?: string | null
          fiscalization_status?: string
          fiscalized?: boolean
          fiscalized_at?: string | null
          fiscalized_by?: string | null
          guest_name?: string | null
          held_at?: string | null
          held_reason?: string | null
          id?: string
          notes?: string | null
          order_code?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_note?: string | null
          payment_status?: string
          preparing_at?: string | null
          ready_at?: string | null
          reco_holdout?: boolean | null
          refunded_amount?: number
          released_to_kitchen_at?: string | null
          served_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_session_id: string
          tip_amount?: number
          total?: number
          updated_at?: string
          venue_id?: string
        }
        Update: {
          assigned_waiter_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_order_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          fiscal_provider_reference?: string | null
          fiscal_receipt_number?: string | null
          fiscalization_error?: string | null
          fiscalization_status?: string
          fiscalized?: boolean
          fiscalized_at?: string | null
          fiscalized_by?: string | null
          guest_name?: string | null
          held_at?: string | null
          held_reason?: string | null
          id?: string
          notes?: string | null
          order_code?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_note?: string | null
          payment_status?: string
          preparing_at?: string | null
          ready_at?: string | null
          reco_holdout?: boolean | null
          refunded_amount?: number
          released_to_kitchen_at?: string | null
          served_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_session_id?: string
          tip_amount?: number
          total?: number
          updated_at?: string
          venue_id?: string
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
            referencedRelation: "session_outcomes"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "orders_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_callback_events: {
        Row: {
          amount_minor: number | null
          created_at: string
          currency: string | null
          detail: string | null
          event_hash: string
          id: string
          monri_order_number: string | null
          normalized_status: string | null
          order_id: string | null
          outcome: string
          payment_transaction_id: string | null
          provider: string
          raw_payload: Json
          venue_id: string | null
        }
        Insert: {
          amount_minor?: number | null
          created_at?: string
          currency?: string | null
          detail?: string | null
          event_hash: string
          id?: string
          monri_order_number?: string | null
          normalized_status?: string | null
          order_id?: string | null
          outcome: string
          payment_transaction_id?: string | null
          provider?: string
          raw_payload?: Json
          venue_id?: string | null
        }
        Update: {
          amount_minor?: number | null
          created_at?: string
          currency?: string | null
          detail?: string | null
          event_hash?: string
          id?: string
          monri_order_number?: string | null
          normalized_status?: string | null
          order_id?: string | null
          outcome?: string
          payment_transaction_id?: string | null
          provider?: string
          raw_payload?: Json
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_callback_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "completed_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_callback_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_callback_events_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_callback_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount_minor: number
          approved_at: string | null
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          monri_order_number: string
          monri_payment_id: string | null
          order_id: string
          provider: string
          provider_payload: Json
          refunded_minor: number
          status: string
          transaction_type: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          amount_minor: number
          approved_at?: string | null
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          monri_order_number: string
          monri_payment_id?: string | null
          order_id: string
          provider?: string
          provider_payload?: Json
          refunded_minor?: number
          status?: string
          transaction_type?: string
          updated_at?: string
          venue_id?: string
        }
        Update: {
          amount_minor?: number
          approved_at?: string | null
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          monri_order_number?: string
          monri_payment_id?: string | null
          order_id?: string
          provider?: string
          provider_payload?: Json
          refunded_minor?: number
          status?: string
          transaction_type?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "completed_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      printers: {
        Row: {
          created_at: string
          device_mac: string | null
          enabled: boolean
          id: string
          last_error: string | null
          last_seen_at: string | null
          last_status: string | null
          last_test_printed_at: string | null
          name: string
          paper_width: number
          plain_text: boolean
          poll_token: string
          protocol: string | null
          station: string
          test_requested_at: string | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          device_mac?: string | null
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          last_status?: string | null
          last_test_printed_at?: string | null
          name: string
          paper_width?: number
          plain_text?: boolean
          poll_token?: string
          protocol?: string | null
          station?: string
          test_requested_at?: string | null
          updated_at?: string
          venue_id?: string
        }
        Update: {
          created_at?: string
          device_mac?: string | null
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          last_status?: string | null
          last_test_printed_at?: string | null
          name?: string
          paper_width?: number
          plain_text?: boolean
          poll_token?: string
          protocol?: string | null
          station?: string
          test_requested_at?: string | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "printers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          rating: number
          table_session_id: string
          venue_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          rating?: number
          table_session_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "session_outcomes"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "ratings_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      reco_clash: {
        Row: {
          candidate_kind: string
          context_kind: string
          note: string | null
        }
        Insert: {
          candidate_kind: string
          context_kind: string
          note?: string | null
        }
        Update: {
          candidate_kind?: string
          context_kind?: string
          note?: string | null
        }
        Relationships: []
      }
      reco_fit: {
        Row: {
          candidate_kind: string
          context_kind: string
          note: string | null
        }
        Insert: {
          candidate_kind: string
          context_kind: string
          note?: string | null
        }
        Update: {
          candidate_kind?: string
          context_kind?: string
          note?: string | null
        }
        Relationships: []
      }
      reco_learned_visits: {
        Row: {
          item_id: string
          learned_at: string
          visit_id: string
        }
        Insert: {
          item_id: string
          learned_at?: string
          visit_id: string
        }
        Update: {
          item_id?: string
          learned_at?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reco_learned_visits_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      reco_learning: {
        Row: {
          ctx_key: string
          ctx_level: string
          item_id: string | null
          last_at: string
          tables: number
          venue_id: string
          w: number
          w_at: string
        }
        Insert: {
          ctx_key: string
          ctx_level: string
          item_id?: string | null
          last_at?: string
          tables?: number
          venue_id?: string
          w?: number
          w_at?: string
        }
        Update: {
          ctx_key?: string
          ctx_level?: string
          item_id?: string | null
          last_at?: string
          tables?: number
          venue_id?: string
          w?: number
          w_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reco_learning_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reco_learning_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_decisions: {
        Row: {
          action_probability: number
          arm: string | null
          candidates: Json
          cart_value: number | null
          chosen_item_id: string | null
          created_at: string
          experiment_id: string | null
          id: string
          placement: string
          policy_version: string
          recommendation_type: string | null
          session_id: string | null
          source_item_id: string | null
          suggested_quantity: number | null
        }
        Insert: {
          action_probability?: number
          arm?: string | null
          candidates?: Json
          cart_value?: number | null
          chosen_item_id?: string | null
          created_at?: string
          experiment_id?: string | null
          id?: string
          placement: string
          policy_version: string
          recommendation_type?: string | null
          session_id?: string | null
          source_item_id?: string | null
          suggested_quantity?: number | null
        }
        Update: {
          action_probability?: number
          arm?: string | null
          candidates?: Json
          cart_value?: number | null
          chosen_item_id?: string | null
          created_at?: string
          experiment_id?: string | null
          id?: string
          placement?: string
          policy_version?: string
          recommendation_type?: string | null
          session_id?: string | null
          source_item_id?: string | null
          suggested_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_decisions_chosen_item_id_fkey"
            columns: ["chosen_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_decisions_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_decisions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_outcomes"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "recommendation_decisions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_decisions_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_impressions: {
        Row: {
          decision_id: string
          seen_at: string
        }
        Insert: {
          decision_id: string
          seen_at?: string
        }
        Update: {
          decision_id?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_impressions_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: true
            referencedRelation: "recommendation_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_settings: {
        Row: {
          after_meal_prompt_minutes: number
          default_cost_pct: Json
          hold_auto_admitted: boolean | null
          hold_burst_sessions: number | null
          hold_first_order_items: number | null
          hold_first_order_km: number | null
          hold_second_session: boolean | null
          hold_unpaid_km: number | null
          id: number
          kitchen_capacity_minutes: number
          kitchen_delay_minutes: number
          kitchen_undo_seconds: number
          last_order_time: string | null
          online_card_enabled: boolean
          ordering_enabled: boolean
          ordering_paused_message: string | null
          pay_at_table_enabled: boolean
          print_auto: boolean
          print_copies: number
          print_enabled: boolean
          print_footer: string
          print_header: string
          print_paper_width: number
          print_show_prices: boolean
          reco_alcohol_from: string
          reco_exploration: number
          reco_holdout_pct: number
          reco_min_acceptance: number
          reco_retire_after_impressions: number
          reco_sampling_enabled: boolean
          reco_weight_curated: number
          reco_weight_learned: number
          reco_weight_margin: number
          reco_weight_observed: number
          recommendations_enabled: boolean
          service_close: string | null
          service_open: string | null
          session_idle_timeout_minutes: number
          social_proof_min_sessions: number
          stale_order_hours: number
          updated_at: string
          venue_id: string
          venue_qr_rotated_at: string
          venue_qr_token: string
        }
        Insert: {
          after_meal_prompt_minutes?: number
          default_cost_pct?: Json
          hold_auto_admitted?: boolean | null
          hold_burst_sessions?: number | null
          hold_first_order_items?: number | null
          hold_first_order_km?: number | null
          hold_second_session?: boolean | null
          hold_unpaid_km?: number | null
          id?: number
          kitchen_capacity_minutes?: number
          kitchen_delay_minutes?: number
          kitchen_undo_seconds?: number
          last_order_time?: string | null
          online_card_enabled?: boolean
          ordering_enabled?: boolean
          ordering_paused_message?: string | null
          pay_at_table_enabled?: boolean
          print_auto?: boolean
          print_copies?: number
          print_enabled?: boolean
          print_footer?: string
          print_header?: string
          print_paper_width?: number
          print_show_prices?: boolean
          reco_alcohol_from?: string
          reco_exploration?: number
          reco_holdout_pct?: number
          reco_min_acceptance?: number
          reco_retire_after_impressions?: number
          reco_sampling_enabled?: boolean
          reco_weight_curated?: number
          reco_weight_learned?: number
          reco_weight_margin?: number
          reco_weight_observed?: number
          recommendations_enabled?: boolean
          service_close?: string | null
          service_open?: string | null
          session_idle_timeout_minutes?: number
          social_proof_min_sessions?: number
          stale_order_hours?: number
          updated_at?: string
          venue_id?: string
          venue_qr_rotated_at?: string
          venue_qr_token?: string
        }
        Update: {
          after_meal_prompt_minutes?: number
          default_cost_pct?: Json
          hold_auto_admitted?: boolean | null
          hold_burst_sessions?: number | null
          hold_first_order_items?: number | null
          hold_first_order_km?: number | null
          hold_second_session?: boolean | null
          hold_unpaid_km?: number | null
          id?: number
          kitchen_capacity_minutes?: number
          kitchen_delay_minutes?: number
          kitchen_undo_seconds?: number
          last_order_time?: string | null
          online_card_enabled?: boolean
          ordering_enabled?: boolean
          ordering_paused_message?: string | null
          pay_at_table_enabled?: boolean
          print_auto?: boolean
          print_copies?: number
          print_enabled?: boolean
          print_footer?: string
          print_header?: string
          print_paper_width?: number
          print_show_prices?: boolean
          reco_alcohol_from?: string
          reco_exploration?: number
          reco_holdout_pct?: number
          reco_min_acceptance?: number
          reco_retire_after_impressions?: number
          reco_sampling_enabled?: boolean
          reco_weight_curated?: number
          reco_weight_learned?: number
          reco_weight_margin?: number
          reco_weight_observed?: number
          recommendations_enabled?: boolean
          service_close?: string | null
          service_open?: string | null
          session_idle_timeout_minutes?: number
          social_proof_min_sessions?: number
          stale_order_hours?: number
          updated_at?: string
          venue_id?: string
          venue_qr_rotated_at?: string
          venue_qr_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_settings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
          venue_id: string
          waiter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          section_id: string
          shift_date?: string
          venue_id?: string
          waiter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          section_id?: string
          shift_date?: string
          venue_id?: string
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
            foreignKeyName: "section_assignments_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
          venue_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          venue_id?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sections_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      server_ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          rating: number
          table_session_id: string
          venue_id: string
          waiter_id: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          table_session_id: string
          venue_id?: string
          waiter_id?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          table_session_id?: string
          venue_id?: string
          waiter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "server_ratings_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "session_outcomes"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "server_ratings_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_ratings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
      session_experiment_assignment: {
        Row: {
          arm: string
          assigned_at: string
          experiment_id: string
          session_id: string
        }
        Insert: {
          arm: string
          assigned_at?: string
          experiment_id: string
          session_id: string
        }
        Update: {
          arm?: string
          assigned_at?: string
          experiment_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_experiment_assignment_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_experiment_assignment_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "session_outcomes"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "session_experiment_assignment_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_item_affinity: {
        Row: {
          a_sessions: number
          computed_at: string
          confidence: number
          confidence_low: number
          eb_mean: number | null
          eb05: number | null
          item_a: string
          item_b: string
          lift: number
          pair_sessions: number
          w_expected: number | null
          w_pair: number | null
        }
        Insert: {
          a_sessions: number
          computed_at?: string
          confidence: number
          confidence_low: number
          eb_mean?: number | null
          eb05?: number | null
          item_a: string
          item_b: string
          lift: number
          pair_sessions: number
          w_expected?: number | null
          w_pair?: number | null
        }
        Update: {
          a_sessions?: number
          computed_at?: string
          confidence?: number
          confidence_low?: number
          eb_mean?: number | null
          eb05?: number | null
          item_a?: string
          item_b?: string
          lift?: number
          pair_sessions?: number
          w_expected?: number | null
          w_pair?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "session_item_affinity_item_a_fkey"
            columns: ["item_a"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_item_affinity_item_b_fkey"
            columns: ["item_b"]
            isOneToOne: false
            referencedRelation: "menu_items"
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
          venue_id: string
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
          venue_id?: string
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
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_join_requests_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "session_outcomes"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "session_join_requests_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_join_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_closes: {
        Row: {
          acknowledged_issues: boolean
          closed_at: string
          closed_by: string | null
          counted_cash: number | null
          counted_terminal: number | null
          created_at: string
          day: string
          expected_cash: number
          expected_online: number
          expected_terminal: number
          id: string
          notes: string | null
          snapshot: Json
          terminal_batch_reference: string | null
          venue_id: string
        }
        Insert: {
          acknowledged_issues?: boolean
          closed_at?: string
          closed_by?: string | null
          counted_cash?: number | null
          counted_terminal?: number | null
          created_at?: string
          day: string
          expected_cash?: number
          expected_online?: number
          expected_terminal?: number
          id?: string
          notes?: string | null
          snapshot?: Json
          terminal_batch_reference?: string | null
          venue_id?: string
        }
        Update: {
          acknowledged_issues?: boolean
          closed_at?: string
          closed_by?: string | null
          counted_cash?: number | null
          counted_terminal?: number | null
          created_at?: string
          day?: string
          expected_cash?: number
          expected_online?: number
          expected_terminal?: number
          id?: string
          notes?: string | null
          snapshot?: Json
          terminal_batch_reference?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_closes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
          venue_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          name: string
          name_ar?: string | null
          name_bs?: string | null
          sort_order?: number
          venue_id?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          name?: string
          name_ar?: string | null
          name_bs?: string | null
          sort_order?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcategories_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      subcategory_affinity: {
        Row: {
          a_orders: number
          computed_at: string
          eb_mean: number
          eb05: number
          pair_orders: number
          sub_a: string
          sub_b: string
          w_expected: number
          w_pair: number
        }
        Insert: {
          a_orders: number
          computed_at?: string
          eb_mean: number
          eb05: number
          pair_orders: number
          sub_a: string
          sub_b: string
          w_expected: number
          w_pair: number
        }
        Update: {
          a_orders?: number
          computed_at?: string
          eb_mean?: number
          eb05?: number
          pair_orders?: number
          sub_a?: string
          sub_b?: string
          w_expected?: number
          w_pair?: number
        }
        Relationships: [
          {
            foreignKeyName: "subcategory_affinity_sub_a_fkey"
            columns: ["sub_a"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcategory_affinity_sub_b_fkey"
            columns: ["sub_b"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_conversions: {
        Row: {
          created_at: string
          decision_id: string | null
          id: string
          line_total: number
          order_id: string
          placement: string
          quantity: number
          recommended_item_id: string
          source_item_id: string | null
        }
        Insert: {
          created_at?: string
          decision_id?: string | null
          id?: string
          line_total?: number
          order_id: string
          placement: string
          quantity?: number
          recommended_item_id: string
          source_item_id?: string | null
        }
        Update: {
          created_at?: string
          decision_id?: string | null
          id?: string
          line_total?: number
          order_id?: string
          placement?: string
          quantity?: number
          recommended_item_id?: string
          source_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_conversions_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "recommendation_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_conversions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "completed_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_conversions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_conversions_recommended_item_id_fkey"
            columns: ["recommended_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_conversions_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_priors: {
        Row: {
          alpha0: number
          beta0: number
          item_accepted: number
          item_shown: number
          placement: string
          recommended_item_id: string | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          alpha0: number
          beta0: number
          item_accepted?: number
          item_shown?: number
          placement: string
          recommended_item_id?: string | null
          updated_at?: string
          venue_id?: string
        }
        Update: {
          alpha0?: number
          beta0?: number
          item_accepted?: number
          item_shown?: number
          placement?: string
          recommended_item_id?: string | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_priors_recommended_item_id_fkey"
            columns: ["recommended_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_priors_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_stats: {
        Row: {
          accepted: number
          attributed_orders: number
          attributed_revenue: number
          daypart: string | null
          dismissed: number
          placement: string
          recommended_item_id: string
          shown: number
          shown_ledger: number
          source_item_id: string | null
          updated_at: string
        }
        Insert: {
          accepted?: number
          attributed_orders?: number
          attributed_revenue?: number
          daypart?: string | null
          dismissed?: number
          placement: string
          recommended_item_id: string
          shown?: number
          shown_ledger?: number
          source_item_id?: string | null
          updated_at?: string
        }
        Update: {
          accepted?: number
          attributed_orders?: number
          attributed_revenue?: number
          daypart?: string | null
          dismissed?: number
          placement?: string
          recommended_item_id?: string
          shown?: number
          shown_ledger?: number
          source_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_stats_recommended_item_id_fkey"
            columns: ["recommended_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_stats_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      table_sessions: {
        Row: {
          assigned_waiter_id: string | null
          auto_admitted_at: string | null
          blocked_at: string | null
          closed_at: string | null
          covers: number | null
          first_order_at: string | null
          guest_name: string | null
          host_client_id: string | null
          id: string
          is_active: boolean
          last_heartbeat_at: string
          last_served_at: string | null
          opened_at: string
          staff_seen_at: string | null
          table_id: string
          token: string
          venue_id: string
        }
        Insert: {
          assigned_waiter_id?: string | null
          auto_admitted_at?: string | null
          blocked_at?: string | null
          closed_at?: string | null
          covers?: number | null
          first_order_at?: string | null
          guest_name?: string | null
          host_client_id?: string | null
          id?: string
          is_active?: boolean
          last_heartbeat_at?: string
          last_served_at?: string | null
          opened_at?: string
          staff_seen_at?: string | null
          table_id: string
          token?: string
          venue_id?: string
        }
        Update: {
          assigned_waiter_id?: string | null
          auto_admitted_at?: string | null
          blocked_at?: string | null
          closed_at?: string | null
          covers?: number | null
          first_order_at?: string | null
          guest_name?: string | null
          host_client_id?: string | null
          id?: string
          is_active?: boolean
          last_heartbeat_at?: string
          last_served_at?: string | null
          opened_at?: string
          staff_seen_at?: string | null
          table_id?: string
          token?: string
          venue_id?: string
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
          {
            foreignKeyName: "table_sessions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          qr_token?: string
          section_id?: string | null
          status?: Database["public"]["Enums"]["table_status"]
          table_number: number
          venue_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          qr_token?: string
          section_id?: string | null
          status?: Database["public"]["Enums"]["table_status"]
          table_number?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tables_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          venue_id: string | null
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          venue_id?: string | null
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          created_at: string
          id: string
          is_live: boolean
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_live?: boolean
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          is_live?: boolean
          name?: string
          slug?: string
        }
        Relationships: []
      }
      waiter_calls: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          id: string
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          table_session_id: string
          venue_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          table_session_id: string
          venue_id?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          table_session_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiter_calls_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "session_outcomes"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "waiter_calls_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
          venue_id: string
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
          venue_id?: string
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
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiters_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      completed_orders: {
        Row: {
          assigned_waiter_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          created_at: string | null
          fiscal_provider_reference: string | null
          fiscal_receipt_number: string | null
          fiscalization_error: string | null
          fiscalization_status: string | null
          fiscalized: boolean | null
          fiscalized_at: string | null
          fiscalized_by: string | null
          guest_name: string | null
          id: string | null
          notes: string | null
          order_code: string | null
          paid_at: string | null
          paid_by: string | null
          payment_method: string | null
          payment_note: string | null
          payment_status: string | null
          preparing_at: string | null
          ready_at: string | null
          refunded_amount: number | null
          released_to_kitchen_at: string | null
          served_at: string | null
          status: Database["public"]["Enums"]["order_status"] | null
          table_session_id: string | null
          tip_amount: number | null
          total: number | null
          updated_at: string | null
        }
        Insert: {
          assigned_waiter_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          fiscal_provider_reference?: string | null
          fiscal_receipt_number?: string | null
          fiscalization_error?: string | null
          fiscalization_status?: string | null
          fiscalized?: boolean | null
          fiscalized_at?: string | null
          fiscalized_by?: string | null
          guest_name?: string | null
          id?: string | null
          notes?: string | null
          order_code?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_note?: string | null
          payment_status?: string | null
          preparing_at?: string | null
          ready_at?: string | null
          refunded_amount?: number | null
          released_to_kitchen_at?: string | null
          served_at?: string | null
          status?: Database["public"]["Enums"]["order_status"] | null
          table_session_id?: string | null
          tip_amount?: number | null
          total?: number | null
          updated_at?: string | null
        }
        Update: {
          assigned_waiter_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          fiscal_provider_reference?: string | null
          fiscal_receipt_number?: string | null
          fiscalization_error?: string | null
          fiscalization_status?: string | null
          fiscalized?: boolean | null
          fiscalized_at?: string | null
          fiscalized_by?: string | null
          guest_name?: string | null
          id?: string | null
          notes?: string | null
          order_code?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_note?: string | null
          payment_status?: string | null
          preparing_at?: string | null
          ready_at?: string | null
          refunded_amount?: number | null
          released_to_kitchen_at?: string | null
          served_at?: string | null
          status?: Database["public"]["Enums"]["order_status"] | null
          table_session_id?: string | null
          tip_amount?: number | null
          total?: number | null
          updated_at?: string | null
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
            referencedRelation: "session_outcomes"
            referencedColumns: ["session_id"]
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
      session_outcomes: {
        Row: {
          avg_minutes_to_served: number | null
          avg_rating: number | null
          closed_at: string | null
          covers: number | null
          first_order_at: string | null
          last_order_at: string | null
          net_sales: number | null
          opened_at: string | null
          orders: number | null
          refunded: number | null
          session_id: string | null
          table_id: string | null
          tips: number | null
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
    }
    Functions: {
      acceptance_for_ranking: {
        Args: {
          _daypart: string
          _item_id: string
          _placement: string
          _seed: string
          _source_item_id: string
        }
        Returns: number
      }
      acceptance_retired: {
        Args: {
          _accepted: number
          _alpha0: number
          _beta0: number
          _min_acceptance: number
          _shown: number
        }
        Returns: boolean
      }
      acceptance_upper95: {
        Args: {
          _accepted: number
          _alpha0: number
          _beta0: number
          _shown: number
        }
        Returns: number
      }
      admin_save_combo: {
        Args: { _combo_item_id: string; _slots: Json }
        Returns: Json
      }
      admin_set_waiter_pin: {
        Args: { _pin: string; _waiter_id: string }
        Returns: undefined
      }
      after_meal_moment: { Args: { _session_id: string }; Returns: boolean }
      analytics_event_allowed: { Args: { _event: string }; Returns: boolean }
      analytics_item_days: {
        Args: { _from: string; _to: string }
        Returns: {
          basis: string
          day: string
          item_id: string
          visits: number
        }[]
      }
      analytics_timestamptz: { Args: { _value: string }; Returns: string }
      analytics_trading_days: {
        Args: { _from: string; _to: string }
        Returns: {
          day: string
          orders: number
          visits: number
        }[]
      }
      analytics_uuid: { Args: { _value: string }; Returns: string }
      analytics_window_start: { Args: { _days: number }; Returns: string }
      ancova_interval: {
        Args: {
          _cov_a: number
          _cov_b: number
          _mean_x_a: number
          _mean_x_b: number
          _mean_y_a: number
          _mean_y_b: number
          _n_a: number
          _n_b: number
          _var_x_a: number
          _var_x_b: number
          _var_y_a: number
          _var_y_b: number
        }
        Returns: Json
      }
      app_impact_summary: { Args: { _days?: number }; Returns: Json }
      assert_guest_session: {
        Args: { _session_id: string; _session_token: string }
        Returns: {
          assigned_waiter_id: string | null
          auto_admitted_at: string | null
          blocked_at: string | null
          closed_at: string | null
          covers: number | null
          first_order_at: string | null
          guest_name: string | null
          host_client_id: string | null
          id: string
          is_active: boolean
          last_heartbeat_at: string
          last_served_at: string | null
          opened_at: string
          staff_seen_at: string | null
          table_id: string
          token: string
          venue_id: string
        }
        SetofOptions: {
          from: "*"
          to: "table_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_session_to_experiment: {
        Args: { _session_id: string }
        Returns: string
      }
      bandit_readiness: { Args: never; Returns: Json }
      basket_weight: {
        Args: { _at: string; _half_life_days?: number; _now?: string }
        Returns: number
      }
      business_day: { Args: { _at?: string }; Returns: string }
      business_day_range: {
        Args: { _day: string }
        Returns: {
          ends_at: string
          starts_at: string
        }[]
      }
      can_admin: { Args: { _venue: string }; Returns: boolean }
      can_staff: { Args: { _venue: string }; Returns: boolean }
      cancel_order: {
        Args: { _order_id: string; _reason: string }
        Returns: Json
      }
      cart_diet: { Args: { _cart_item_ids: string[] }; Returns: string }
      cart_has_drink: { Args: { _cart_item_ids: string[] }; Returns: boolean }
      claim_ticket_print: {
        Args: { _device_id: string; _order_id: string; _ticket_type?: string }
        Returns: boolean
      }
      close_shift: {
        Args: {
          _acknowledge_issues?: boolean
          _counted_cash?: number
          _counted_terminal?: number
          _day?: string
          _notes?: string
          _terminal_batch_reference?: string
          _venue?: string
        }
        Returns: Json
      }
      close_stale_orders: { Args: { _hours?: number }; Returns: Json }
      close_stale_sessions: { Args: never; Returns: number }
      cloud_print_candidates: {
        Args: { _types: string[] }
        Returns: {
          attempts: number
          claimed_at: string | null
          claimed_by_device: string | null
          created_at: string
          destination: string | null
          exported_at: string | null
          format: string
          id: string
          last_error: string | null
          order_id: string
          original_printed_at: string | null
          payload: Json
          print_verified: boolean | null
          printed_at: string | null
          status: string
          ticket_type: string
          updated_at: string
          venue_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "order_ticket_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cloud_print_claim: {
        Args: { _ticket_id?: string; _token: string }
        Returns: Json
      }
      cloud_print_report: {
        Args: {
          _error?: string
          _ok: boolean
          _ticket_id: string
          _token: string
        }
        Returns: string
      }
      cloud_printer_checkin: {
        Args: {
          _mac?: string
          _protocol?: string
          _status?: string
          _token: string
        }
        Returns: Json
      }
      cloud_printer_test_done: {
        Args: { _error?: string; _ok: boolean; _token: string }
        Returns: undefined
      }
      covers_summary: { Args: { _day?: string }; Returns: Json }
      current_venue: { Args: never; Returns: string }
      daily_anomalies: { Args: never; Returns: Json }
      day_reconciliation: { Args: { _day?: string }; Returns: Json }
      daypart_acceptance: {
        Args: {
          _daypart: string
          _item_id: string
          _placement: string
          _source_item_id: string
        }
        Returns: number
      }
      daypart_of: { Args: { _at?: string }; Returns: string }
      decision_performance: {
        Args: { _days?: number }
        Returns: {
          acceptance_pct: number
          accepted: number
          decisions: number
          placement: string
          policy_version: string
          revenue: number
          seen: number
          with_suggestion: number
        }[]
      }
      default_cost_share: {
        Args: { _role: Database["public"]["Enums"]["meal_role"] }
        Returns: number
      }
      default_venue: { Args: never; Returns: string }
      eb_lower05: {
        Args: { _alpha?: number; _beta?: number; _e: number; _n: number }
        Returns: number
      }
      eb_posterior_mean: {
        Args: { _alpha?: number; _beta?: number; _e: number; _n: number }
        Returns: number
      }
      enqueue_order_ticket: {
        Args: { _order_id: string; _ticket_type?: string }
        Returns: string
      }
      enqueue_station_tickets: { Args: { _order_id: string }; Returns: string }
      experiment_power: {
        Args: { _experiment_id: string; _mde_pct?: number }
        Returns: Json
      }
      experiment_srm: { Args: { _experiment_id: string }; Returns: Json }
      food_cost_coverage: { Args: never; Returns: Json }
      funnel_summary: { Args: { _from?: string; _to?: string }; Returns: Json }
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
      guest_check_venue_token: { Args: { _token: string }; Returns: Json }
      guest_forget_me: { Args: { _client_id: string }; Returns: Json }
      guest_get_combos: { Args: never; Returns: Json }
      guest_get_join_request: {
        Args: { _client_id: string; _request_id: string; _session_id: string }
        Returns: Json
      }
      guest_get_order_payment: {
        Args: { _order_id: string; _session_id: string; _session_token: string }
        Returns: Json
      }
      guest_get_recommendations: {
        Args: {
          _cart_item_ids?: string[]
          _cart_quantities?: number[]
          _exclude_allergens?: string[]
          _exclude_item_ids?: string[]
          _language?: string
          _limit?: number
          _placement?: string
          _require_tags?: string[]
          _session_id: string
          _session_token: string
        }
        Returns: {
          decision_id: string
          dietary_tags: string[]
          id: string
          image_url: string
          name: string
          name_ar: string
          name_bs: string
          price: number
          reason: string
          recommendation_type: string
          source_item_id: string
          suggested_quantity: number
        }[]
      }
      guest_get_service_status: { Args: never; Returns: Json }
      guest_get_substitutes: {
        Args: { _item_id: string; _limit?: number }
        Returns: {
          dietary_tags: string[]
          id: string
          image_url: string
          match_reason: string
          name: string
          name_ar: string
          name_bs: string
          price: number
        }[]
      }
      guest_get_tab: {
        Args: { _session_id: string; _session_token: string }
        Returns: Json
      }
      guest_get_waiter_for_review: {
        Args: { _session_id: string; _session_token: string }
        Returns: Json
      }
      guest_in_reco_holdout: { Args: { _session_id: string }; Returns: boolean }
      guest_inspect_table: {
        Args: { _client_id: string; _qr_token: string; _table_number: number }
        Returns: Json
      }
      guest_leave_session: {
        Args: { _session_id: string; _session_token: string }
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
      guest_mark_suggestion_seen: {
        Args: {
          _decision_id: string
          _session_id: string
          _session_token: string
        }
        Returns: undefined
      }
      guest_order_eta: { Args: { _order_id: string }; Returns: Json }
      guest_place_order: {
        Args: {
          _client_order_id?: string
          _guest_name: string
          _items: Json
          _payment_method: string
          _session_id: string
          _session_token: string
          _tip?: number
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
      guest_resume_session: {
        Args: { _session_id: string; _session_token: string }
        Returns: Json
      }
      guest_search_menu: {
        Args: { _limit?: number; _query: string }
        Returns: {
          category_name: string
          description: string
          description_ar: string
          description_bs: string
          dietary_tags: string[]
          id: string
          image_url: string
          is_available: boolean
          merchandising_tags: string[]
          name: string
          name_ar: string
          name_bs: string
          price: number
          subcategory_id: string
        }[]
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
      guest_switch_to_pay_at_table: {
        Args: {
          _method?: string
          _order_id: string
          _session_id: string
          _session_token: string
        }
        Returns: Json
      }
      guest_table_venue: {
        Args: { _qr_token: string; _table_number: number }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hash_uniforms: {
        Args: { _seed: string }
        Returns: {
          u1: number
          u2: number
        }[]
      }
      in_service_hours: {
        Args: { _at: string; _close: string; _open: string }
        Returns: boolean
      }
      is_staff_member: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_trusted_caller: { Args: never; Returns: boolean }
      item_prep_estimate: {
        Args: { _item_id: string }
        Returns: {
          minutes: number
          source: string
        }[]
      }
      item_trends: {
        Args: { _prior_days?: number; _recent_days?: number }
        Returns: {
          cost_estimated: boolean
          days0: number
          days1: number
          e0: number
          e1: number
          is_available: boolean
          item_id: string
          k0: number
          k1: number
          name: string
          price: number
          unit_cm: number
          units1: number
        }[]
      }
      kds_all_day: {
        Args: { _station?: string }
        Returns: {
          menu_item_id: string
          name: string
          oldest_at: string
          open_ids: string[]
          pending_ids: string[]
          qty_pending: number
          qty_preparing: number
          qty_ready: number
          station: string
        }[]
      }
      kitchen_load: {
        Args: never
        Returns: {
          backlog_minutes: number
          load_factor: number
          open_items: number
          station: string
        }[]
      }
      looked_at_not_ordered: {
        Args: { _days?: number; _limit?: number }
        Returns: {
          adds: number
          item_id: string
          name: string
          order_rate: number
          orders: number
          views: number
        }[]
      }
      management_insights: {
        Args: { _days?: number; _min_km?: number }
        Returns: {
          action: string
          confidence: string
          est_km_per_week: number
          evidence: number
          evidence_label: string
          headline: string
          item_id: string
          kind: string
          link: string
          related_item_id: string
          why: string
        }[]
      }
      mark_session_seen: { Args: { _session_id: string }; Returns: undefined }
      maybe_enable_sampling: { Args: never; Returns: Json }
      maybe_refresh_menu_intelligence: {
        Args: { _max_age_minutes?: number }
        Returns: Json
      }
      menu_engineering: {
        Args: { _days?: number }
        Returns: {
          availability_basis: string
          available_days: number
          category_name: string
          class_avg_cm: number
          class_items: number
          class_lines: number
          class_units: number
          class_units_per_week: number
          cost_estimated: boolean
          is_available: boolean
          item_id: string
          lines: number
          menu_class: string
          menu_mix: number
          mix_high: number
          mix_low: number
          name: string
          popularity: string
          popularity_threshold: number
          price: number
          profitability: string
          quadrant: string
          revenue: number
          trading_days: number
          unit_cm: number
          unit_cost: number
          units: number
          units_per_week: number
        }[]
      }
      menu_item_orderable: {
        Args: {
          _at?: string
          _item: Database["public"]["Tables"]["menu_items"]["Row"]
        }
        Returns: boolean
      }
      menu_item_performance: {
        Args: { _days?: number }
        Returns: {
          abandon_rate: number
          add_rate: number
          adds: number
          category_name: string
          created_at: string
          is_available: boolean
          item_id: string
          margin_score: number
          name: string
          order_rate: number
          orders: number
          price: number
          removes: number
          revenue: number
          subcategory_name: string
          units: number
          views: number
        }[]
      }
      menu_item_sale_price: {
        Args: {
          _at?: string
          _item: Database["public"]["Tables"]["menu_items"]["Row"]
        }
        Returns: number
      }
      menu_item_unit_price: {
        Args: {
          _at?: string
          _item: Database["public"]["Tables"]["menu_items"]["Row"]
        }
        Returns: number
      }
      menu_pairings: {
        Args: { _limit?: number }
        Returns: {
          already_curated: boolean
          confidence: number
          item_a: string
          item_b: string
          lift: number
          name_a: string
          name_b: string
          pair_orders: number
        }[]
      }
      menu_unit_margins: {
        Args: never
        Returns: {
          cost_estimated: boolean
          item_id: string
          price: number
          unit_cm: number
          unit_cost: number
        }[]
      }
      monri_apply_callback: {
        Args: {
          _amount_minor: number
          _currency: string
          _event_hash: string
          _monri_order_number: string
          _monri_payment_id: string
          _normalized_status: string
          _raw: Json
        }
        Returns: Json
      }
      monri_record_attempt_response: {
        Args: {
          _monri_payment_id: string
          _ok: boolean
          _payload: Json
          _payment_transaction_id: string
        }
        Returns: undefined
      }
      monri_register_attempt: {
        Args: {
          _currency?: string
          _order_id: string
          _session_id: string
          _session_token: string
          _transaction_type?: string
        }
        Returns: Json
      }
      next_order_code: { Args: { _venue?: string }; Returns: string }
      online_card_payments_enabled: { Args: never; Returns: boolean }
      order_hold_reason: {
        Args: { _item_count: number; _items_total: number; _session_id: string }
        Returns: string
      }
      order_item_status_rank: {
        Args: { _s: Database["public"]["Enums"]["order_item_status"] }
        Returns: number
      }
      order_revert_allowed: {
        Args: {
          _from: Database["public"]["Enums"]["order_status"]
          _to: Database["public"]["Enums"]["order_status"]
        }
        Returns: boolean
      }
      order_status_rank: {
        Args: { _s: Database["public"]["Enums"]["order_status"] }
        Returns: number
      }
      order_transition_allowed: {
        Args: {
          _from: Database["public"]["Enums"]["order_status"]
          _to: Database["public"]["Enums"]["order_status"]
        }
        Returns: boolean
      }
      orders_needing_attention: {
        Args: { _hours?: number }
        Returns: {
          hours_open: number
          id: string
          order_code: string
          payment_status: string
          problem: string
          status: Database["public"]["Enums"]["order_status"]
          table_number: number
          total: number
        }[]
      }
      pair_strength: { Args: { _eb05: number }; Returns: number }
      payment_status_rank: { Args: { _status: string }; Returns: number }
      popular_items_for_daypart: {
        Args: { _daypart: string; _days?: number; _limit?: number }
        Returns: {
          menu_item_id: string
          qty: number
          relative: number
          share: number
        }[]
      }
      prep_confidence_threshold: { Args: never; Returns: number }
      prep_history: { Args: { _day?: string }; Returns: Json }
      price_order_lines: {
        Args: { _at?: string; _items: Json }
        Returns: {
          components: Json
          line_no: number
          menu_item_id: string
          notes: string
          quantity: number
          regular_unit_price: number
          unit_price: number
        }[]
      }
      printer_health: {
        Args: never
        Returns: {
          enabled: boolean
          id: string
          last_error: string
          last_seen_at: string
          last_status: string
          name: string
          online: boolean
          protocol: string
          station: string
          waiting: number
        }[]
      }
      printer_ticket_types: { Args: { _station: string }; Returns: string[] }
      prune_analytics_events: { Args: { _days?: number }; Returns: number }
      prune_recommendation_decisions: {
        Args: { _days?: number }
        Returns: number
      }
      rank_recommendations: {
        Args: {
          _cart_item_ids?: string[]
          _cart_quantities?: number[]
          _exclude_allergens?: string[]
          _language?: string
          _limit?: number
          _placement?: string
          _session_id?: string
        }
        Returns: {
          dietary_tags: string[]
          id: string
          image_url: string
          name: string
          name_ar: string
          name_bs: string
          price: number
          reason: string
          recommendation_type: string
          source_item_id: string
          suggested_quantity: number
        }[]
      }
      rebuild_reco_learning: { Args: { _days?: number }; Returns: Json }
      reclassify_meal_roles: { Args: never; Returns: Json }
      reco_decayed: {
        Args: { _at: string; _w: number; _w_at: string }
        Returns: number
      }
      reco_funnel: {
        Args: { _days?: number }
        Returns: {
          decisions: number
          km_per_1000_seen: number
          paid: number
          paid_km: number
          placement: string
          seen: number
          tapped: number
          week_start: string
          with_suggestion: number
        }[]
      }
      reco_holdout_comparison: { Args: { _days?: number }; Returns: Json }
      reco_kind: {
        Args: {
          _name: string
          _role: Database["public"]["Enums"]["meal_role"]
          _section: string
          _station?: string
        }
        Returns: string
      }
      reco_learn_visit: { Args: { _visit: string }; Returns: number }
      reco_learned_pairs: {
        Args: { _at?: string; _context: string[] }
        Returns: {
          attach: number
          item_id: string
          level: string
          lift: number
          source_item_id: string
          strength: number
          tables: number
        }[]
      }
      reco_learning_keys: {
        Args: { _items: string[] }
        Returns: {
          ctx_key: string
          ctx_level: string
          item_id: string
        }[]
      }
      reco_now: { Args: never; Returns: string }
      reco_policy_version: { Args: never; Returns: string }
      reco_role_fits: {
        Args: {
          _at?: string
          _candidate_role: Database["public"]["Enums"]["meal_role"]
          _cart: string[]
          _is_curated: boolean
          _no_alcohol?: boolean
          _placement: string
          _rtype: string
          _session_id: string
        }
        Returns: boolean
      }
      reco_vetoed: {
        Args: {
          _at: string
          _curated: boolean
          _kind: string
          _placement?: string
          _role: Database["public"]["Enums"]["meal_role"]
        }
        Returns: boolean
      }
      recommendation_engine_health: { Args: never; Returns: Json }
      record_analytics_events: {
        Args: { _events: Json; _visit_id: string }
        Returns: number
      }
      record_order_refund: {
        Args: {
          _amount: number
          _mark_completed?: boolean
          _method: string
          _order_id: string
          _provider_reference?: string
          _reason: string
        }
        Returns: Json
      }
      record_table_payment: {
        Args: { _method: string; _note?: string; _order_id: string }
        Returns: Json
      }
      refresh_guest_profiles: { Args: never; Returns: number }
      refresh_menu_affinity: {
        Args: { _days?: number; _min_pair_orders?: number }
        Returns: number
      }
      refresh_menu_intelligence: { Args: never; Returns: Json }
      refresh_prep_stats: { Args: { _days?: number }; Returns: number }
      refresh_session_affinity: {
        Args: { _days?: number; _min_pair_sessions?: number }
        Returns: number
      }
      refresh_suggestion_priors: { Args: never; Returns: number }
      refresh_suggestion_stats: { Args: { _days?: number }; Returns: number }
      release_order_to_kitchen: {
        Args: { _order_id: string }
        Returns: boolean
      }
      repeat_blocked: {
        Args: { _item_id: string; _session_id: string }
        Returns: boolean
      }
      report_ticket_print: {
        Args: {
          _error?: string
          _ok: boolean
          _order_id: string
          _ticket_type?: string
          _verified?: boolean
        }
        Returns: undefined
      }
      requeue_stale_ticket_prints: {
        Args: { _older_than_seconds?: number }
        Returns: number
      }
      requeue_ticket_print: {
        Args: { _order_id: string; _ticket_type?: string }
        Returns: Json
      }
      resolve_table_for_token: {
        Args: { _table_number: number; _token: string }
        Returns: {
          created_at: string
          id: string
          qr_token: string
          section_id: string | null
          status: Database["public"]["Enums"]["table_status"]
          table_number: number
          venue_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tables"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      returning_guest_stats: { Args: { _days?: number }; Returns: Json }
      role_is_drink: {
        Args: { _role: Database["public"]["Enums"]["meal_role"] }
        Returns: boolean
      }
      role_repeat_minutes: {
        Args: { _role: Database["public"]["Enums"]["meal_role"] }
        Returns: number
      }
      rotate_table_qr_token: { Args: { _table_id: string }; Returns: string }
      rotate_venue_qr_token: { Args: never; Returns: string }
      run_daily_maintenance: { Args: never; Returns: Json }
      run_scheduled_learning_refresh: { Args: never; Returns: Json }
      run_scheduled_maintenance: { Args: never; Returns: Json }
      sales_analytics: { Args: { _from?: string; _to?: string }; Returns: Json }
      sales_change_terms: {
        Args: {
          _cmp_covered: number
          _cmp_covers: number
          _cmp_net: number
          _cmp_units: number
          _cmp_visits: number
          _covered: number
          _covers: number
          _net: number
          _scale: number
          _units: number
          _use_covers: boolean
          _visits: number
        }
        Returns: Json
      }
      sales_components: {
        Args: { _from: string; _to: string }
        Returns: {
          covered_visits: number
          covers: number
          daypart: string
          net: number
          units: number
          visits: number
        }[]
      }
      sales_decomposition: {
        Args: {
          _cmp_from?: string
          _cmp_to?: string
          _from?: string
          _to?: string
        }
        Returns: Json
      }
      sample_acceptance:
        | {
            Args: { _accepted: number; _seed: string; _shown: number }
            Returns: number
          }
        | {
            Args: {
              _accepted: number
              _alpha0: number
              _beta0: number
              _seed: string
              _shown: number
            }
            Returns: number
          }
      session_context: {
        Args: { _session_id: string }
        Returns: {
          avg_line_price: number
          covers: number
          has_served_main: boolean
          line_count: number
          minutes_since_served: number
          ordered_item_ids: string[]
          running_total: number
          served_item_ids: string[]
        }[]
      }
      session_idle_timeout: { Args: never; Returns: number }
      session_outstanding: {
        Args: { _session_id: string }
        Returns: {
          outstanding: number
          unpaid_orders: number
        }[]
      }
      set_order_fiscalization: {
        Args: {
          _error?: string
          _order_id: string
          _provider_reference?: string
          _receipt_number?: string
          _status: string
        }
        Returns: Json
      }
      shift_close_for: {
        Args: { _day?: string; _venue?: string }
        Returns: Json
      }
      smoothed_acceptance:
        | { Args: { _accepted: number; _shown: number }; Returns: number }
        | {
            Args: {
              _accepted: number
              _alpha0: number
              _beta0: number
              _shown: number
            }
            Returns: number
          }
      sold_out_impact: {
        Args: { _days?: number }
        Returns: {
          avg_daily_revenue_when_available: number
          estimated_lost_revenue: number
          item_id: string
          last_sold_day: string
          name: string
          revenue: number
          selling_days: number
          views: number
        }[]
      }
      staff_ack_bill_request: { Args: { _request_id: string }; Returns: Json }
      staff_ack_waiter_call: { Args: { _call_id: string }; Returns: Json }
      staff_block_session: {
        Args: { _reason?: string; _session_id: string }
        Returns: Json
      }
      staff_bump_order_item: {
        Args: {
          _item_id: string
          _status: Database["public"]["Enums"]["order_item_status"]
        }
        Returns: Json
      }
      staff_bump_order_items: {
        Args: {
          _item_ids: string[]
          _status: Database["public"]["Enums"]["order_item_status"]
        }
        Returns: Json
      }
      staff_close_session: { Args: { _session_id: string }; Returns: Json }
      staff_mark_session_seen: { Args: { _session_id: string }; Returns: Json }
      staff_performance: {
        Args: { _from?: string; _to?: string }
        Returns: Json
      }
      staff_release_held_order: { Args: { _order_id: string }; Returns: Json }
      staff_resolve_bill_request: {
        Args: { _close_session?: boolean; _request_id: string }
        Returns: Json
      }
      staff_resolve_waiter_call: { Args: { _call_id: string }; Returns: Json }
      staff_revert_order_status: {
        Args: {
          _order_id: string
          _reason?: string
          _to: Database["public"]["Enums"]["order_status"]
        }
        Returns: Json
      }
      staff_set_covers: {
        Args: { _covers: number; _session_id: string }
        Returns: Json
      }
      staff_take_table: { Args: { _session_id: string }; Returns: Json }
      staff_update_order_status: {
        Args: {
          _order_id: string
          _status: Database["public"]["Enums"]["order_status"]
        }
        Returns: Json
      }
      start_experiment: {
        Args: { _holdout_pct?: number; _name: string; _policy_version: string }
        Returns: Json
      }
      station_timings: { Args: { _days?: number }; Returns: Json }
      stop_experiment: { Args: { _notes?: string }; Returns: Json }
      suggestion_evidence: {
        Args: { _recommended_item_id: string; _source_item_id: string }
        Returns: Json
      }
      suggestion_impact: { Args: { _days?: number }; Returns: Json }
      suggestion_impact_by_placement: {
        Args: { _days?: number }
        Returns: {
          acceptance_pct: number
          accepted: number
          attributed_revenue: number
          placement: string
          revenue_per_impression: number
          shown: number
        }[]
      }
      suggestion_performance: {
        Args: { _limit?: number }
        Returns: {
          acceptance_rate: number
          accepted: number
          attributed_revenue: number
          dismissed: number
          placement: string
          recommended_item_id: string
          recommended_name: string
          revenue_per_impression: number
          shown: number
          smoothed_rate: number
          source_item_id: string
          source_name: string
          status: string
        }[]
      }
      suggestion_prior: {
        Args: { _item_id: string; _placement: string }
        Returns: {
          alpha0: number
          beta0: number
          item_shown: number
        }[]
      }
      touch_session: { Args: { _id: string; _token: string }; Returns: boolean }
      two_proportion_interval: {
        Args: { _n_a: number; _n_b: number; _x_a: number; _x_b: number }
        Returns: Json
      }
      use_venue: { Args: { _venue: string }; Returns: string }
      verify_waiter_pin: {
        Args: { _pin: string; _waiter_id: string }
        Returns: boolean
      }
      welch_interval: {
        Args: {
          _mean_a: number
          _mean_b: number
          _n_a: number
          _n_b: number
          _var_a: number
          _var_b: number
        }
        Returns: Json
      }
      wilson_interval: {
        Args: { _n: number; _p: number; _z?: number }
        Returns: {
          high: number
          low: number
        }[]
      }
      wilson_lower: {
        Args: { _successes: number; _trials: number; _z?: number }
        Returns: number
      }
      write_audit: {
        Args: {
          _action: string
          _actor_label?: string
          _after?: Json
          _before?: Json
          _correlation_id?: string
          _entity_id: string
          _entity_type: string
          _reason?: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "staff"
      meal_role:
        | "starter"
        | "main"
        | "side"
        | "dessert"
        | "hot_drink"
        | "cold_drink"
        | "alcohol"
      order_item_status: "pending" | "preparing" | "ready" | "served"
      order_status:
        | "awaiting_payment"
        | "payment_failed"
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
      app_role: ["admin", "staff"],
      meal_role: [
        "starter",
        "main",
        "side",
        "dessert",
        "hot_drink",
        "cold_drink",
        "alcohol",
      ],
      order_item_status: ["pending", "preparing", "ready", "served"],
      order_status: [
        "awaiting_payment",
        "payment_failed",
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
