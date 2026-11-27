import { createHash } from 'node:crypto';

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(ordenar);
  }

  if (valor !== null && typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>;

    return Object.fromEntries(
      Object.keys(objeto)
        .sort()
        .map(chave => [
          chave,
          ordenar(objeto[chave])
        ])
    );
  }

  return valor;
}

export function gerarHash(dados: unknown): string {
  const json = JSON.stringify(ordenar(dados));

  return createHash('sha256')
    .update(json)
    .digest('hex');
}