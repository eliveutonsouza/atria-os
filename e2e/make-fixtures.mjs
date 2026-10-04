// Gera os arquivos de teste da base da Empresa: PDF de texto (com tabela) e imagem "escaneada" (OCR).
import { chromium } from 'playwright';
const html = `<html><body style="font-family:Arial;padding:40px;color:#111">
<h1>Tabela de precos E2E Yui</h1>
<p>Valores validos de 01/01/2026 a 31/12/2026. Pagamento em ate 3x no cartao ou 40% de entrada e 60% na entrega.</p>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>Servico</th><th>Preco</th><th>Prazo</th></tr>
<tr><td>Site institucional</td><td>R$ 4.900</td><td>15 dias</td></tr>
<tr><td>Automacao com IA</td><td>R$ 1.200 por mes</td><td>10 dias</td></tr>
</table>
<h2>Desconto</h2><p>Pagamento a vista tem 10% de desconto. Codigo interno do teste: ZEBRA-4471.</p>
</body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
await p.setContent(html);
await p.pdf({ path: 'fixtures/precos-e2e.pdf', format: 'A4' });
await p.setContent(`<html><body style="margin:0;background:#f2efe6;font-family:Georgia;padding:50px;transform:rotate(-1.2deg)">
<h2>Recibo de servico</h2><p>Cliente: Padaria Sol Nascente</p><p>Valor pago: R$ 780,00</p><p>Referencia do teste: OCR-TUCANO-93</p></body></html>`);
await p.screenshot({ path: 'fixtures/recibo-escaneado.png' });
await b.close();
