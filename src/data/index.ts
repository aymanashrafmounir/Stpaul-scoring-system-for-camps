import { hasSupabaseEnv } from '../lib/supabase'
import type { CampRepository } from '../types'
import { supabaseRepository } from './supabaseRepository'

if (!hasSupabaseEnv) {
  throw new Error('Supabase production configuration is missing')
}

export const repository: CampRepository = supabaseRepository
