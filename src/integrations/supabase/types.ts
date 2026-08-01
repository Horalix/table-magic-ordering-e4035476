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
          visit_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: number
          occurred_at?: string
          props?: Json
          visit_id: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: number
          occurred_at?: string
          props?: Json
          visit_id?: string
        }
        Relationships: []
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
        }
        Relationships: []
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
      menu_item_affinity: {
        Row: {
          a_orders: number
          computed_at: string
          confidence: number
          item_a: string
          item_b: string
          lift: number
          pair_orders: number
        }
        Insert: {
          a_orders?: number
          computed_at?: string
          confidence?: number
          item_a: string
          item_b: string
          lift?: number
          pair_orders?: number
        }
        Update: {
          a_orders?: number
          computed_at?: string
          confidence?: number
          item_a?: string
          item_b?: string
          lift?: number
          pair_orders?: number
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
          id: string
          image_url: string | null
          is_available: boolean
          margin_score: number
          merchandising_tags: string[]
          name: string
          name_ar: string | null
          name_bs: string | null
          portion_note: string | null
          prep_minutes: number | null
          price: number
          sort_order: number
          station: string
          subcategory_id: string
          updated_at: string
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
          id?: string
          image_url?: string | null
          is_available?: boolean
          margin_score?: number
          merchandising_tags?: string[]
          name: string
          name_ar?: string | null
          name_bs?: string | null
          portion_note?: string | null
          prep_minutes?: number | null
          price: number
          sort_order?: number
          station?: string
          subcategory_id: string
          updated_at?: string
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
          id?: string
          image_url?: string | null
          is_available?: boolean
          margin_score?: number
          merchandising_tags?: string[]
          name?: string
          name_ar?: string | null
          name_bs?: string | null
          portion_note?: string | null
          prep_minutes?: number | null
          price?: number
          sort_order?: number
          station?: string
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
      order_code_counters: {
        Row: {
          day: string
          last_value: number
        }
        Insert: {
          day: string
          last_value?: number
        }
        Update: {
          day?: string
          last_value?: number
        }
        Relationships: []
      }
      order_items: {
        Row: {
          bumped_by: string | null
          created_at: string
          id: string
          menu_item_id: string
          notes: string | null
          order_id: string
          quantity: number
          ready_at: string | null
          served_at: string | null
          started_at: string | null
          station: string
          status: Database["public"]["Enums"]["order_item_status"]
          unit_price: number
        }
        Insert: {
          bumped_by?: string | null
          created_at?: string
          id?: string
          menu_item_id: string
          notes?: string | null
          order_id: string
          quantity?: number
          ready_at?: string | null
          served_at?: string | null
          started_at?: string | null
          station?: string
          status?: Database["public"]["Enums"]["order_item_status"]
          unit_price: number
        }
        Update: {
          bumped_by?: string | null
          created_at?: string
          id?: string
          menu_item_id?: string
          notes?: string | null
          order_id?: string
          quantity?: number
          ready_at?: string | null
          served_at?: string | null
          started_at?: string | null
          station?: string
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
          payload: Json
          print_verified: boolean | null
          printed_at: string | null
          status: string
          ticket_type: string
          updated_at: string
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
          payload?: Json
          print_verified?: boolean | null
          printed_at?: string | null
          status?: string
          ticket_type?: string
          updated_at?: string
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
          payload?: Json
          print_verified?: boolean | null
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
        ]
      }
      orders: {
        Row: {
          assigned_waiter_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
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
          refunded_amount: number
          released_to_kitchen_at: string | null
          served_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          table_session_id: string
          tip_amount: number
          total: number
          updated_at: string
        }
        Insert: {
          assigned_waiter_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
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
          refunded_amount?: number
          released_to_kitchen_at?: string | null
          served_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_session_id: string
          tip_amount?: number
          total?: number
          updated_at?: string
        }
        Update: {
          assigned_waiter_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
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
          refunded_amount?: number
          released_to_kitchen_at?: string | null
          served_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_session_id?: string
          tip_amount?: number
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
      restaurant_settings: {
        Row: {
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
          reco_exploration: number
          reco_holdout_pct: number
          reco_min_acceptance: number
          reco_retire_after_impressions: number
          reco_weight_curated: number
          reco_weight_learned: number
          reco_weight_margin: number
          reco_weight_observed: number
          recommendations_enabled: boolean
          session_idle_timeout_minutes: number
          updated_at: string
          venue_qr_rotated_at: string
          venue_qr_token: string
        }
        Insert: {
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
          reco_exploration?: number
          reco_holdout_pct?: number
          reco_min_acceptance?: number
          reco_retire_after_impressions?: number
          reco_weight_curated?: number
          reco_weight_learned?: number
          reco_weight_margin?: number
          reco_weight_observed?: number
          recommendations_enabled?: boolean
          session_idle_timeout_minutes?: number
          updated_at?: string
          venue_qr_rotated_at?: string
          venue_qr_token?: string
        }
        Update: {
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
          reco_exploration?: number
          reco_holdout_pct?: number
          reco_min_acceptance?: number
          reco_retire_after_impressions?: number
          reco_weight_curated?: number
          reco_weight_learned?: number
          reco_weight_margin?: number
          reco_weight_observed?: number
          recommendations_enabled?: boolean
          session_idle_timeout_minutes?: number
          updated_at?: string
          venue_qr_rotated_at?: string
          venue_qr_token?: string
        }
        Relationships: []
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
        }
        Relationships: []
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
      suggestion_conversions: {
        Row: {
          created_at: string
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
      suggestion_stats: {
        Row: {
          accepted: number
          attributed_orders: number
          attributed_revenue: number
          dismissed: number
          placement: string
          recommended_item_id: string
          shown: number
          source_item_id: string
          updated_at: string
        }
        Insert: {
          accepted?: number
          attributed_orders?: number
          attributed_revenue?: number
          dismissed?: number
          placement: string
          recommended_item_id: string
          shown?: number
          source_item_id: string
          updated_at?: string
        }
        Update: {
          accepted?: number
          attributed_orders?: number
          attributed_revenue?: number
          dismissed?: number
          placement?: string
          recommended_item_id?: string
          shown?: number
          source_item_id?: string
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
          table_id: string
          token: string
        }
        Insert: {
          assigned_waiter_id?: string | null
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
          table_id: string
          token?: string
        }
        Update: {
          assigned_waiter_id?: string | null
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
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          id: string
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          table_session_id: string
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
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_set_waiter_pin: {
        Args: { _pin: string; _waiter_id: string }
        Returns: undefined
      }
      analytics_event_allowed: { Args: { _event: string }; Returns: boolean }
      assert_guest_session: {
        Args: { _session_id: string; _session_token: string }
        Returns: {
          assigned_waiter_id: string | null
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
      cancel_order: {
        Args: { _order_id: string; _reason: string }
        Returns: Json
      }
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
        }
        Returns: Json
      }
      close_stale_sessions: { Args: never; Returns: number }
      covers_summary: { Args: { _day?: string }; Returns: Json }
      day_reconciliation: { Args: { _day?: string }; Returns: Json }
      daypart_of: { Args: { _at?: string }; Returns: string }
      enqueue_order_ticket: {
        Args: { _order_id: string; _ticket_type?: string }
        Returns: string
      }
      enqueue_station_tickets: { Args: { _order_id: string }; Returns: string }
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
        }[]
      }
      guest_get_service_status: { Args: never; Returns: Json }
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
      guest_order_eta: { Args: { _order_id: string }; Returns: Json }
      guest_place_order: {
        Args: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff_member: { Args: never; Returns: boolean }
      item_prep_estimate: {
        Args: { _item_id: string }
        Returns: {
          minutes: number
          source: string
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
      next_order_code: { Args: never; Returns: string }
      online_card_payments_enabled: { Args: never; Returns: boolean }
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
      payment_status_rank: { Args: { _status: string }; Returns: number }
      prep_confidence_threshold: { Args: never; Returns: number }
      reco_holdout_comparison: { Args: { _days?: number }; Returns: Json }
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
      refresh_menu_affinity: {
        Args: { _days?: number; _min_pair_orders?: number }
        Returns: number
      }
      refresh_menu_intelligence: { Args: never; Returns: Json }
      refresh_prep_stats: { Args: { _days?: number }; Returns: number }
      refresh_suggestion_stats: { Args: { _days?: number }; Returns: number }
      release_order_to_kitchen: {
        Args: { _order_id: string }
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
        }
        SetofOptions: {
          from: "*"
          to: "tables"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rotate_table_qr_token: { Args: { _table_id: string }; Returns: string }
      rotate_venue_qr_token: { Args: never; Returns: string }
      sales_analytics: { Args: { _from?: string; _to?: string }; Returns: Json }
      session_idle_timeout: { Args: never; Returns: number }
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
      shift_close_for: { Args: { _day?: string }; Returns: Json }
      smoothed_acceptance: {
        Args: { _accepted: number; _shown: number }
        Returns: number
      }
      sold_out_impact: {
        Args: { _days?: number }
        Returns: {
          avg_daily_revenue_when_available: number
          estimated_lost_revenue: number
          item_id: string
          name: string
          views: number
        }[]
      }
      staff_ack_bill_request: { Args: { _request_id: string }; Returns: Json }
      staff_ack_waiter_call: { Args: { _call_id: string }; Returns: Json }
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
      staff_update_order_status: {
        Args: {
          _order_id: string
          _status: Database["public"]["Enums"]["order_status"]
        }
        Returns: Json
      }
      suggestion_impact: { Args: { _days?: number }; Returns: Json }
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
      touch_session: { Args: { _id: string; _token: string }; Returns: boolean }
      verify_waiter_pin: {
        Args: { _pin: string; _waiter_id: string }
        Returns: boolean
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
