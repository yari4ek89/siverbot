import MTProtoCollector from './collector.js';

let mtprotoClient = null;

export function getMtprotoClient(deps) {
  if (!mtprotoClient) mtprotoClient = new MTProtoCollector(deps);
  return mtprotoClient;
}
