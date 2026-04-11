/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, ChangeEvent } from 'react';
import { 
  FileText, 
  RotateCcw, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  FileUp, 
  Loader2,
  ArrowRight,
  Info,
  AlertTriangle,
  FileCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Interfaces
interface AuditItem {
  sku_ou_descricao: string;
  quantidade_devolvida: number;
  quantidade_origem: number;
  valor_unitario_devolucao: number;
  valor_unitario_origem: number;
  icms_valor_devolucao?: number;
  icms_valor_origem?: number;
  ipi_valor_devolucao?: number;
  ipi_valor_origem?: number;
  desconto_valor_devolucao?: number;
  desconto_valor_origem?: number;
  status_item: 'OK' | 'ERRO';
}

interface ParticipantInfo {
  razao_social: string;
  cnpj: string;
  cidade: string;
  endereco: string;
}

interface CarrierInfo {
  razao_social: string;
  cnpj: string;
  endereco: string;
}

interface AuditResult {
  analise_geral: 'APROVADA' | 'REPROVADA';
  chave_acesso_referenciada_encontrada: boolean;
  resumo_auditoria: string;
  divergencias_encontradas: string[];
  itens_conferidos: AuditItem[];
  participantes?: {
    remetente_nfo: ParticipantInfo;
    destinatario_nfo: ParticipantInfo;
    remetente_nfd: ParticipantInfo;
    destinatario_nfd: ParticipantInfo;
  };
  transportadora?: {
    nfo: CarrierInfo;
    nfd: CarrierInfo;
    conferência_ok: boolean;
    detalhes?: string;
  };
  conferência_participantes?: {
    remetente_ok: boolean;
    destinatario_ok: boolean;
    detalhes?: string;
  };
  conferência_impostos?: {
    icms_ok: boolean;
    ipi_ok: boolean;
    detalhes?: string;
  };
}

export default function App() {
  const [isAuditing, setIsAuditing] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<{ nfo: File | null; nfd: File | null }>({ nfo: null, nfd: null });
  
  const nfoInputRef = useRef<HTMLInputElement>(null);
  const nfdInputRef = useRef<HTMLInputElement>(null);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleAudit = async () => {
    if (!files.nfo || !files.nfd) {
      setError("Por favor, anexe ambos os arquivos (NFO e NFD) antes de auditar.");
      return;
    }

    setIsAuditing(true);
    setResult(null);
    setError(null);

    try {
      const nfoBase64 = await fileToBase64(files.nfo);
      const nfdBase64 = await fileToBase64(files.nfd);

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                text: `Analise NFO e NFD anexadas.
                Regras: 
                1. Cruzar itens (SKU/EAN/Desc).
                2. Qtd NFD <= Qtd NFO.
                3. Vlr Unit NFD == Vlr Unit NFO.
                4. Impostos (ICMS/IPI) e Descontos: Devem ser proporcionais à devolução. Extraia os valores de origem (NFO) e devolução (NFD) de ICMS, IPI e Desconto por item.
                5. Participantes: Extraia Razão Social, CNPJ, Cidade e Endereço de Remetente e Destinatário de ambos os documentos. Validar se na NFD correspondem inversamente à NFO.
                6. Transportadora: Extraia Razão Social, CNPJ e Endereço da transportadora de ambos os documentos. Verifique se são a mesma ou se há divergência.
                Retorne JSON.`
              },
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: nfoBase64
                }
              },
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: nfdBase64
                }
              }
            ]
          }
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              analise_geral: { type: Type.STRING, enum: ["APROVADA", "REPROVADA"] },
              chave_acesso_referenciada_encontrada: { type: Type.BOOLEAN },
              resumo_auditoria: { type: Type.STRING },
              divergencias_encontradas: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING } 
              },
              itens_conferidos: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sku_ou_descricao: { type: Type.STRING },
                    quantidade_devolvida: { type: Type.NUMBER },
                    quantidade_origem: { type: Type.NUMBER },
                    valor_unitario_devolucao: { type: Type.NUMBER },
                    valor_unitario_origem: { type: Type.NUMBER },
                    icms_valor_devolucao: { type: Type.NUMBER },
                    icms_valor_origem: { type: Type.NUMBER },
                    ipi_valor_devolucao: { type: Type.NUMBER },
                    ipi_valor_origem: { type: Type.NUMBER },
                    desconto_valor_devolucao: { type: Type.NUMBER },
                    desconto_valor_origem: { type: Type.NUMBER },
                    status_item: { type: Type.STRING, enum: ["OK", "ERRO"] }
                  },
                  required: ["sku_ou_descricao", "quantidade_devolvida", "quantidade_origem", "valor_unitario_devolucao", "valor_unitario_origem", "status_item"]
                }
              },
              participantes: {
                type: Type.OBJECT,
                properties: {
                  remetente_nfo: { 
                    type: Type.OBJECT, 
                    properties: { razao_social: { type: Type.STRING }, cnpj: { type: Type.STRING }, cidade: { type: Type.STRING }, endereco: { type: Type.STRING } },
                    required: ["razao_social", "cnpj", "cidade", "endereco"]
                  },
                  destinatario_nfo: { 
                    type: Type.OBJECT, 
                    properties: { razao_social: { type: Type.STRING }, cnpj: { type: Type.STRING }, cidade: { type: Type.STRING }, endereco: { type: Type.STRING } },
                    required: ["razao_social", "cnpj", "cidade", "endereco"]
                  },
                  remetente_nfd: { 
                    type: Type.OBJECT, 
                    properties: { razao_social: { type: Type.STRING }, cnpj: { type: Type.STRING }, cidade: { type: Type.STRING }, endereco: { type: Type.STRING } },
                    required: ["razao_social", "cnpj", "cidade", "endereco"]
                  },
                  destinatario_nfd: { 
                    type: Type.OBJECT, 
                    properties: { razao_social: { type: Type.STRING }, cnpj: { type: Type.STRING }, cidade: { type: Type.STRING }, endereco: { type: Type.STRING } },
                    required: ["razao_social", "cnpj", "cidade", "endereco"]
                  }
                },
                required: ["remetente_nfo", "destinatario_nfo", "remetente_nfd", "destinatario_nfd"]
              },
              transportadora: {
                type: Type.OBJECT,
                properties: {
                  nfo: {
                    type: Type.OBJECT,
                    properties: { razao_social: { type: Type.STRING }, cnpj: { type: Type.STRING }, endereco: { type: Type.STRING } },
                    required: ["razao_social", "cnpj", "endereco"]
                  },
                  nfd: {
                    type: Type.OBJECT,
                    properties: { razao_social: { type: Type.STRING }, cnpj: { type: Type.STRING }, endereco: { type: Type.STRING } },
                    required: ["razao_social", "cnpj", "endereco"]
                  },
                  conferência_ok: { type: Type.BOOLEAN },
                  detalhes: { type: Type.STRING }
                },
                required: ["nfo", "nfd", "conferência_ok"]
              },
              conferência_participantes: {
                type: Type.OBJECT,
                properties: {
                  remetente_ok: { type: Type.BOOLEAN },
                  destinatario_ok: { type: Type.BOOLEAN },
                  detalhes: { type: Type.STRING }
                },
                required: ["remetente_ok", "destinatario_ok"]
              },
              conferência_impostos: {
                type: Type.OBJECT,
                properties: {
                  icms_ok: { type: Type.BOOLEAN },
                  ipi_ok: { type: Type.BOOLEAN },
                  detalhes: { type: Type.STRING }
                },
                required: ["icms_ok", "ipi_ok"]
              }
            },
            required: ["analise_geral", "chave_acesso_referenciada_encontrada", "resumo_auditoria", "divergencias_encontradas", "itens_conferidos", "conferência_participantes", "conferência_impostos"]
          }
        }
      });

      const auditData = JSON.parse(response.text);
      setResult(auditData);
    } catch (err) {
      console.error("Erro na auditoria:", err);
      setError("Ocorreu um erro ao processar os arquivos. Verifique se são PDFs válidos e tente novamente.");
    } finally {
      setIsAuditing(false);
    }
  };

  const handleFileChange = (type: 'nfo' | 'nfd', e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFiles(prev => ({ ...prev, [type]: file }));
    setError(null);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 py-4 px-6 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Search className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">ConfNF</h1>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Módulo de conferencia fiscal</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-sm text-slate-500">
            <span className="flex items-center gap-1"><Info className="w-4 h-4" /> Suporte: 0800-AUDIT</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] mx-auto w-full p-6 space-y-8">
        
        {/* Top Section: Upload Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          <section className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <FileUp className="w-5 h-5 text-blue-600" />
              Upload de Documentos
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* NFO Dropzone */}
              <div className="group relative">
                <input 
                  type="file" 
                  ref={nfoInputRef}
                  className="hidden" 
                  accept=".pdf"
                  onChange={(e) => handleFileChange('nfo', e)}
                />
                <div 
                  onClick={() => nfoInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer h-32 text-center ${
                    files.nfo 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50/50'
                  }`}
                >
                  <div className={`p-2 rounded-full transition-transform group-hover:scale-110 ${
                    files.nfo ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-600'
                  }`}>
                    {files.nfo ? <FileCheck className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Nota Fiscal de Origem</p>
                    <p className="text-xs text-slate-400 mt-1 truncate max-w-[250px]">
                      {files.nfo ? files.nfo.name : '(NFO - Venda)'}
                    </p>
                  </div>
                </div>
              </div>

              {/* NFD Dropzone */}
              <div className="group relative">
                <input 
                  type="file" 
                  ref={nfdInputRef}
                  className="hidden" 
                  accept=".pdf"
                  onChange={(e) => handleFileChange('nfd', e)}
                />
                <div 
                  onClick={() => nfdInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer h-32 text-center ${
                    files.nfd 
                      ? 'border-emerald-500 bg-emerald-50' 
                      : 'border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/50'
                  }`}
                >
                  <div className={`p-2 rounded-full transition-transform group-hover:scale-110 ${
                    files.nfd ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-600'
                  }`}>
                    {files.nfd ? <FileCheck className="w-5 h-5" /> : <RotateCcw className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Nota Fiscal de Devolução</p>
                    <p className="text-xs text-slate-400 mt-1 truncate max-w-[250px]">
                      {files.nfd ? files.nfd.name : '(NFD - Retorno)'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-rose-50 border border-rose-100 rounded-lg flex items-center gap-2 text-rose-600 text-sm animate-pulse">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            <button 
              onClick={handleAudit}
              disabled={isAuditing || !files.nfo || !files.nfd}
              className="w-full mt-6 bg-slate-900 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-3 transition-all hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-slate-200"
            >
              {isAuditing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Analisando Dados Reais...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Conferir NFs</span>
                </>
              )}
            </button>
          </section>

          {/* Helper Card */}
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-100 p-6 rounded-2xl flex flex-col gap-3 h-full">
              <div className="flex items-center gap-2 text-blue-600">
                <Info className="w-5 h-5" />
                <h3 className="font-bold text-sm uppercase tracking-wider">Processamento Real</h3>
              </div>
              <p className="text-sm text-blue-700 leading-relaxed">
                Ao clicar em conferir, os PDFs são enviados para a IA que extrai os dados diretamente dos documentos para comparação.
              </p>
              <div className="mt-auto pt-4 border-t border-blue-100">
                <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">Status do Sistema: Online</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Section: Results Area */}
        <div className="w-full">
          <AnimatePresence mode="wait">
            {isAuditing ? (
              <motion.div 
                key="loading"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="h-full min-h-[400px] flex flex-col items-center justify-center text-center p-8 bg-white rounded-2xl border border-slate-200"
              >
                <div className="relative">
                  <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Search className="w-6 h-6 text-blue-400" />
                  </div>
                </div>
                <h3 className="mt-6 text-xl font-bold text-slate-800">Extraindo dados dos seus PDFs...</h3>
                <p className="mt-2 text-slate-500 max-w-xs">A IA está lendo cada item, quantidade e valor unitário para garantir a conformidade fiscal.</p>
              </motion.div>
            ) : result ? (
              <motion.div 
                key="results"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                {/* Status Card */}
                <div className={`p-6 rounded-2xl border flex items-start gap-4 ${
                  result.analise_geral === 'APROVADA' 
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}>
                  <div className={`p-3 rounded-xl ${
                    result.analise_geral === 'APROVADA' ? 'bg-emerald-100' : 'bg-rose-100'
                  }`}>
                    {result.analise_geral === 'APROVADA' 
                      ? <CheckCircle2 className="w-8 h-8 text-emerald-600" /> 
                      : <AlertCircle className="w-8 h-8 text-rose-600" />
                    }
                  </div>
                  <div className="flex-1">
                    <h3 className="text-2xl font-black uppercase tracking-tight">
                      Análise {result.analise_geral}
                    </h3>
                    <p className="text-slate-700 mt-1 font-medium leading-relaxed">
                      {result.resumo_auditoria}
                    </p>
                    
                    {/* Participant & Tax Summary */}
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className={`text-[10px] font-bold px-3 py-2 rounded-lg flex items-center gap-2 ${
                        result.conferência_participantes?.remetente_ok && result.conferência_participantes?.destinatario_ok
                          ? 'bg-emerald-100/50 text-emerald-700'
                          : 'bg-rose-100/50 text-rose-700'
                      }`}>
                        <Search className="w-3 h-3" />
                        PARTICIPANTES: {result.conferência_participantes?.remetente_ok && result.conferência_participantes?.destinatario_ok ? 'CONFERIDOS' : 'DIVERGENTES'}
                      </div>
                      <div className={`text-[10px] font-bold px-3 py-2 rounded-lg flex items-center gap-2 ${
                        result.conferência_impostos?.icms_ok && result.conferência_impostos?.ipi_ok
                          ? 'bg-emerald-100/50 text-emerald-700'
                          : 'bg-rose-100/50 text-rose-700'
                      }`}>
                        <Info className="w-3 h-3" />
                        IMPOSTOS: {result.conferência_impostos?.icms_ok && result.conferência_impostos?.ipi_ok ? 'PROPORCIONAIS' : 'DIVERGENTES'}
                      </div>
                      <div className={`text-[10px] font-bold px-3 py-2 rounded-lg flex items-center gap-2 ${
                        result.transportadora?.conferência_ok
                          ? 'bg-emerald-100/50 text-emerald-700'
                          : 'bg-rose-100/50 text-rose-700'
                      }`}>
                        <RotateCcw className="w-3 h-3" />
                        TRANSPORTADORA: {result.transportadora?.conferência_ok ? 'CONFERIDA' : 'DIVERGENTE'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Divergences Section */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Divergências Encontradas
                  </h4>
                  
                  {result.divergencias_encontradas.length === 0 ? (
                    <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-center gap-3 text-emerald-700">
                      <CheckCircle2 className="w-5 h-5" />
                      <span className="font-medium">Nenhuma divergência de valores ou quantidades encontrada.</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {result.divergencias_encontradas.map((div, idx) => (
                        <div key={idx} className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-xl text-amber-900 flex gap-3">
                          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                          <p className="text-sm font-medium">{div}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Participants Table */}
                {result.participantes && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                      <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Dados de Participantes (NFO vs NFD)</h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse table-fixed">
                        <thead>
                          <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 border-b border-slate-100">
                            <th className="px-4 py-3 w-32">Papel</th>
                            <th className="px-4 py-3 w-32">Documento</th>
                            <th className="px-4 py-3 w-1/4">Razão Social</th>
                            <th className="px-4 py-3 w-48">CNPJ</th>
                            <th className="px-4 py-3 w-40">Cidade</th>
                            <th className="px-4 py-3 w-1/3">Endereço</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          <tr>
                            <td className="px-4 py-3 font-bold text-blue-600">Remetente</td>
                            <td className="px-4 py-3 text-slate-500">NFO (Origem)</td>
                            <td className="px-4 py-3 text-slate-800 break-words">{result.participantes.remetente_nfo.razao_social}</td>
                            <td className="px-4 py-3 text-slate-800">{result.participantes.remetente_nfo.cnpj}</td>
                            <td className="px-4 py-3 text-slate-800">{result.participantes.remetente_nfo.cidade}</td>
                            <td className="px-4 py-3 text-slate-800 break-words">{result.participantes.remetente_nfo.endereco}</td>
                          </tr>
                          <tr className="bg-slate-50/30">
                            <td className="px-4 py-3 font-bold text-emerald-600">Destinatário</td>
                            <td className="px-4 py-3 text-slate-500">NFD (Devolução)</td>
                            <td className="px-4 py-3 text-slate-800 break-words">{result.participantes.destinatario_nfd.razao_social}</td>
                            <td className="px-4 py-3 text-slate-800">{result.participantes.destinatario_nfd.cnpj}</td>
                            <td className="px-4 py-3 text-slate-800">{result.participantes.destinatario_nfd.cidade}</td>
                            <td className="px-4 py-3 text-slate-800 break-words">{result.participantes.destinatario_nfd.endereco}</td>
                          </tr>
                          <tr className="border-t-2 border-slate-100">
                            <td className="px-4 py-3 font-bold text-blue-600">Destinatário</td>
                            <td className="px-4 py-3 text-slate-500">NFO (Origem)</td>
                            <td className="px-4 py-3 text-slate-800 break-words">{result.participantes.destinatario_nfo.razao_social}</td>
                            <td className="px-4 py-3 text-slate-800">{result.participantes.destinatario_nfo.cnpj}</td>
                            <td className="px-4 py-3 text-slate-800">{result.participantes.destinatario_nfo.cidade}</td>
                            <td className="px-4 py-3 text-slate-800 break-words">{result.participantes.destinatario_nfo.endereco}</td>
                          </tr>
                          <tr className="bg-slate-50/30">
                            <td className="px-4 py-3 font-bold text-emerald-600">Remetente</td>
                            <td className="px-4 py-3 text-slate-500">NFD (Devolução)</td>
                            <td className="px-4 py-3 text-slate-800 break-words">{result.participantes.remetente_nfd.razao_social}</td>
                            <td className="px-4 py-3 text-slate-800">{result.participantes.remetente_nfd.cnpj}</td>
                            <td className="px-4 py-3 text-slate-800">{result.participantes.remetente_nfd.cidade}</td>
                            <td className="px-4 py-3 text-slate-800 break-words">{result.participantes.remetente_nfd.endereco}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Carrier Table */}
                {result.transportadora && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                      <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Conferência de Transportadora</h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse table-fixed">
                        <thead>
                          <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 border-b border-slate-100">
                            <th className="px-4 py-3 w-40">Documento</th>
                            <th className="px-4 py-3 w-1/3">Razão Social</th>
                            <th className="px-4 py-3 w-48">CNPJ</th>
                            <th className="px-4 py-3 w-1/2">Endereço</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          <tr>
                            <td className="px-4 py-3 text-slate-500 font-medium">NFO (Origem)</td>
                            <td className="px-4 py-3 text-slate-800 font-bold break-words">{result.transportadora.nfo.razao_social || 'N/A'}</td>
                            <td className="px-4 py-3 text-slate-800">{result.transportadora.nfo.cnpj || 'N/A'}</td>
                            <td className="px-4 py-3 text-slate-800 break-words">{result.transportadora.nfo.endereco || '-'}</td>
                          </tr>
                          <tr className="bg-slate-50/30">
                            <td className="px-4 py-3 text-slate-500 font-medium">NFD (Devolução)</td>
                            <td className="px-4 py-3 text-slate-800 font-bold break-words">{result.transportadora.nfd.razao_social || 'N/A'}</td>
                            <td className="px-4 py-3 text-slate-800">{result.transportadora.nfd.cnpj || 'N/A'}</td>
                            <td className="px-4 py-3 text-slate-800 break-words">{result.transportadora.nfd.endereco || '-'}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    {result.transportadora.detalhes && (
                      <div className="p-3 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-500 italic">
                        Nota: {result.transportadora.detalhes}
                      </div>
                    )}
                  </div>
                )}

                {/* Items Table */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Itens, Impostos e Descontos</h4>
                    <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-2 py-1 rounded-full">
                      {result.itens_conferidos.length} ITENS
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-center border-collapse">
                      <thead>
                        <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-widest bg-slate-50 border-b border-slate-100">
                          <th className="px-4 py-3 text-left font-bold" rowSpan={2}>Produto (NFD)</th>
                          <th className="px-4 py-3 border-r border-slate-100" rowSpan={2}>Qtd NFD</th>
                          <th className="px-4 py-2 border-r border-slate-100" colSpan={2}>Vlr Unitário</th>
                          <th className="px-4 py-2 text-blue-600 border-r border-slate-100" colSpan={2}>ICMS</th>
                          <th className="px-4 py-2 text-emerald-600 border-r border-slate-100" colSpan={2}>IPI</th>
                          <th className="px-4 py-2 text-rose-600 border-r border-slate-100" colSpan={2}>Desconto</th>
                          <th className="px-4 py-3" rowSpan={2}>Status</th>
                        </tr>
                        <tr className="text-[9px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 border-b border-slate-100">
                          <th className="px-2 py-2">NFO</th>
                          <th className="px-2 py-2 border-r border-slate-100">NFD</th>
                          <th className="px-2 py-2 text-blue-400">NFO</th>
                          <th className="px-2 py-2 text-blue-400 border-r border-slate-100">NFD</th>
                          <th className="px-2 py-2 text-emerald-400">NFO</th>
                          <th className="px-2 py-2 text-emerald-400 border-r border-slate-100">NFD</th>
                          <th className="px-2 py-2 text-rose-400">NFO</th>
                          <th className="px-2 py-2 text-rose-400 border-r border-slate-100">NFD</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {result.itens_conferidos.map((item, idx) => (
                          <tr key={idx} className={`transition-colors ${
                            item.status_item === 'ERRO' ? 'bg-rose-50/30' : ''
                          }`}>
                            <td className="px-4 py-3 text-left">
                              <p className="text-xs font-bold text-slate-800">{item.sku_ou_descricao}</p>
                            </td>
                            <td className="px-4 py-3 text-sm font-black text-slate-900 border-r border-slate-100 border-l border-slate-100">{item.quantidade_devolvida}</td>
                            
                            <td className="px-2 py-3 text-xs font-medium text-slate-400">R$ {item.valor_unitario_origem.toFixed(2)}</td>
                            <td className="px-2 py-3 text-xs font-bold text-slate-800 border-r border-slate-100">R$ {item.valor_unitario_devolucao.toFixed(2)}</td>
                            
                            <td className="px-2 py-3 text-xs font-medium text-blue-300">R$ {item.icms_valor_origem?.toFixed(2) || '0.00'}</td>
                            <td className="px-2 py-3 text-xs font-bold text-blue-700 border-r border-slate-100">R$ {item.icms_valor_devolucao?.toFixed(2) || '0.00'}</td>
                            
                            <td className="px-2 py-3 text-xs font-medium text-emerald-300">R$ {item.ipi_valor_origem?.toFixed(2) || '0.00'}</td>
                            <td className="px-2 py-3 text-xs font-bold text-emerald-700 border-r border-slate-100">R$ {item.ipi_valor_devolucao?.toFixed(2) || '0.00'}</td>
                            
                            <td className="px-2 py-3 text-xs font-medium text-rose-300">R$ {item.desconto_valor_origem?.toFixed(2) || '0.00'}</td>
                            <td className="px-2 py-3 text-xs font-bold text-rose-700 border-r border-slate-100">R$ {item.desconto_valor_devolucao?.toFixed(2) || '0.00'}</td>
                            
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tighter ${
                                item.status_item === 'OK' 
                                  ? 'bg-emerald-100 text-emerald-700' 
                                  : 'bg-rose-100 text-rose-700'
                              }`}>
                                {item.status_item === 'OK' ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                                {item.status_item}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-900 border-t-2 border-slate-900">
                          <td className="px-4 py-4 text-left font-bold text-xs text-white uppercase tracking-wider">
                            Totais de Conferência
                          </td>
                          <td className="px-4 py-4 text-center font-bold text-base text-white border-x border-slate-800">
                            {result.itens_conferidos.reduce((acc, item) => acc + item.quantidade_devolvida, 0)}
                          </td>
                          <td colSpan={7}></td>
                          <td colSpan={2} className="px-4 py-4 text-right">
                            <div className="flex items-center justify-end gap-3 text-[11px] font-bold text-slate-300 uppercase tracking-widest leading-none">
                              <span>Total Qtd NFO: <span className="text-white text-base font-black ml-1">
                                {result.itens_conferidos.reduce((acc, item) => acc + item.quantidade_origem, 0)}
                              </span></span>
                              <span className="w-px h-4 bg-slate-700"></span>
                              <span>Total Qtd NFD: <span className="text-white text-base font-black ml-1">
                                {result.itens_conferidos.reduce((acc, item) => acc + item.quantidade_devolvida, 0)}
                              </span></span>
                            </div>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center p-8 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200">
                <div className="bg-white p-4 rounded-2xl shadow-sm mb-4">
                  <FileText className="w-12 h-12 text-slate-300" />
                </div>
                <h3 className="text-lg font-bold text-slate-400">Aguardando documentos reais...</h3>
                <p className="text-sm text-slate-400 mt-1">Anexe os arquivos PDF para que a IA possa extrair e conferir os dados.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-400 font-medium tracking-tight">
            © 2026 ConfNF - Inteligência Artificial Aplicada ao Compliance Fiscal.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-xs text-slate-400 hover:text-slate-600 transition-colors font-bold uppercase tracking-widest">Privacidade</a>
            <a href="#" className="text-xs text-slate-400 hover:text-slate-600 transition-colors font-bold uppercase tracking-widest">Termos</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
