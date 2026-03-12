export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      politicos: {
        Row: {
          id: number
          nome: string
          sigla_partido: string
          sigla_uf: string
          url_foto: string | null
          ativo: boolean
          atualizado_em: string
        }
        Insert: {
          id: number
          nome: string
          sigla_partido: string
          sigla_uf: string
          url_foto?: string | null
          ativo?: boolean
          atualizado_em?: string
        }
        Update: {
          id?: number
          nome?: string
          sigla_partido?: string
          sigla_uf?: string
          url_foto?: string | null
          ativo?: boolean
          atualizado_em?: string
        }
      }
      votacoes: {
        Row: {
          id: string
          sigla_tipo: string | null
          numero: number | null
          ano: number | null
          ementa: string | null
          data_votacao: string
        }
        Insert: {
          id: string
          sigla_tipo?: string | null
          numero?: number | null
          ano?: number | null
          ementa?: string | null
          data_votacao: string
        }
        Update: {
          id?: string
          sigla_tipo?: string | null
          numero?: number | null
          ano?: number | null
          ementa?: string | null
          data_votacao?: string
        }
      }
      votos_deputados: {
        Row: {
          id: string
          votacao_id: string | null
          politico_id: number | null
          voto: string
        }
        Insert: {
          id?: string
          votacao_id?: string | null
          politico_id?: number | null
          voto: string
        }
        Update: {
          id?: string
          votacao_id?: string | null
          politico_id?: number | null
          voto?: string
        }
      }
      despesas: {
        Row: {
          id: string
          politico_id: number | null
          ano: number
          mes: number
          tipo_despesa: string
          valor_liquido: number
          url_documento: string | null
          fornecedor: string | null
        }
        Insert: {
          id?: string
          politico_id?: number | null
          ano: number
          mes: number
          tipo_despesa: string
          valor_liquido: number
          url_documento?: string | null
          fornecedor?: string | null
        }
        Update: {
          id?: string
          politico_id?: number | null
          ano?: number
          mes?: number
          tipo_despesa?: string
          valor_liquido?: number
          url_documento?: string | null
          fornecedor?: string | null
        }
      }
      avaliacoes: {
        Row: {
          id: string
          politico_id: number | null
          cpf_hash: string
          nota: number
          data_avaliacao: string
        }
        Insert: {
          id?: string
          politico_id?: number | null
          cpf_hash: string
          nota: number
          data_avaliacao?: string
        }
        Update: {
          id?: string
          politico_id?: number | null
          cpf_hash?: string
          nota?: number
          data_avaliacao?: string
        }
      }
    }
    Views: {
      [_: string]: {
        Row: {
          [key: string]: Json
        }
      }
    }
    Functions: {
      [_: string]: {
        Args: {
          [key: string]: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_: string]: never
    }
  }
}
