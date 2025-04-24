import { createClient } from '@supabase/supabase-js';
// Reemplaza con tus credenciales de Supabase
const SUPABASE_URL = 'https://vljaisdvadywiyqrvryd.supabase.co';
const SUPABASE_KEY = process.env.SERVICE_ROLE as string;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default supabase;