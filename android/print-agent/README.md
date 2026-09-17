# Agente Android legado

> Esta ponte é mantida como alternativa para hardware Android/Bluetooth. Os equipamentos que substituíram os tablets são mini PCs Windows e devem usar o agente x86 da Bematech.

> O protocolo atual, provisionamento, journal, recuperação e limitações de hardware estão em [docs/IMPRESSAO_V2.md](../../docs/IMPRESSAO_V2.md).

Este aplicativo não participa do fluxo dos mini PCs Windows. Para a operação atual do Açougue da Loja 2, o trabalho entra na fila `tablet-pompeia-01` e é consumido pelo agente Windows x86 ligado à Bematech local.

A POS-5890A é uma impressora ESC/POS de 58 mm com USB e Bluetooth. O navegador do tablet não deve ser responsável pela impressão: o Web Bluetooth atende periféricos BLE/GATT, enquanto as impressoras térmicas desse tipo normalmente usam Bluetooth clássico/RFCOMM. O agente usa o socket Bluetooth clássico do Android e envia os mesmos bytes ESC/POS usados pelo totem.

## Configuração do servidor

Configure as variáveis de ambiente do backend:

```env
TABLET_PRINTER_KIOSK_ID=tablet-pompeia-01
TABLET_PRINTER_MODE=sector
TABLET_PRINTER_SECTOR_ID=acougue-loja-2
TABLET_PRINTER_STORE_CODE=loja-2
TABLET_PRINTER_NAME=POS-5890A-L
TABLET_PRINTER_PORT=BLUETOOTH
TABLET_PAPER_WIDTH_MM=58
PRINT_AGENT_KIOSKS_JSON={"totem-pompeia-01":"token-do-totem","tablet-pompeia-01":"token-do-tablet"}
```

O token do tablet deve ter pelo menos 32 caracteres e ser diferente do token do totem.

## Execução no tablet

1. Emparelhe a POS-5890A-L nas configurações de Bluetooth do Android. Se o aparelho pedir um PIN, use o código indicado na etiqueta ou no manual que acompanha a unidade.
2. Compile e instale o módulo `android/print-agent` no tablet que ficará junto à impressora.
3. Abra o aplicativo, informe a URL do SenhaHub, o token do tablet e selecione a impressora pareada.
4. Inicie o agente e mantenha a notificação ativa. Faça uma emissão de teste no tablet do Açougue.

O agente confirma o trabalho depois de enviar os bytes à impressora e mantém um registro local para não reimprimir o mesmo trabalho quando a internet cair depois da impressão.
