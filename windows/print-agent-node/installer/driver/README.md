# Driver USB/serial Bematech x64

Pacote: Bematech USB/COM V4.0.2, INF `bematech-usbcom.inf`, versão 4.0.2.32103.

Os três arquivos deste diretório foram extraídos da subpasta `W10_x64` de `windows/print-agent-totem/driver/Driver_USB_Bematech-V4.0.2.zip`. A cópia fica isolada neste agente para que o build do instalador Node não dependa dos arquivos de outro agente.

O INF declara arquitetura `ntamd64` e associa `USB\VID_0B1B&PID_0003` à Bematech MP-4200 TH. O instalador inclui apenas o INF, o catálogo assinado e o `.sys` dessa versão x64.

O agente imprime por COM e não usa fila/spooler do Windows; portanto este é o driver incluído. A instalação usa PnPUtil e remove somente pacotes publicados cujo nome original seja exatamente `bematech-usbcom.inf`.
