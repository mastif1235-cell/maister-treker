/* Protocol dispatch for the MCP endpoint. Designed against the current MCP
   specification (2026-07-28, stateless core): no session state, every request
   self-contained. For backward compatibility with clients on session-based
   revisions (2025-06-18 and older in the field) `initialize` is answered with
   the requested supported version, and the `notifications/initialized`
   notification is accepted (and answered with 202 by the transport). */

import {makeResult, makeError, ERROR_CODES, isNotification} from '../jsonrpc.js';
import {validateAgainstSchema} from '../tools/validate.js';
import {TOOL_DEFINITIONS} from '../tools/definitions.js';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];

export function createMcpServer(options){
  const tools = options.tools;
  const toolDefs = options.toolDefs || TOOL_DEFINITIONS;
  const serverInfo = options.serverInfo || {name:'maister-tracker-mcp', version:'0.1.0'};
  const instructions = options.instructions ||
    'Сервер читання даних «Майстер-Трекера» (заявки, зміни, звіти). Дати — ДД.ММ.РРРР. ' +
    'Усі інструменти read-only; поля паролів/логінів/приватних нотаток і Telegram-службові поля не віддаються.';

  function initialize(message){
    const requested = message.params && typeof message.params === 'object' ? String(message.params.protocolVersion || '') : '';
    const chosen = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
    return makeResult(message.id, {
      protocolVersion: chosen,
      capabilities: {tools: {listChanged: false}},
      serverInfo,
      instructions
    });
  }

  async function callTool(message){
    const params = message.params && typeof message.params === 'object' ? message.params : {};
    const name = typeof params.name === 'string' ? params.name : '';
    const def = toolDefs.find(function(candidate){ return candidate.name === name; });
    if(!def) return makeError(message.id, ERROR_CODES.INVALID_PARAMS, 'Unknown tool: ' + name);
    const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
    const validation = validateAgainstSchema(def.inputSchema, args);
    if(!validation.ok){
      return makeError(message.id, ERROR_CODES.INVALID_PARAMS, 'Invalid arguments for tool ' + name, validation.errors);
    }
    let outcome;
    try{ outcome = await tools[name](args); }
    catch(err){
      return makeResult(message.id, {
        content: [{type:'text', text:'MCP_TOOL_ERROR: INTERNAL: ' + String(err && err.message || err)}],
        isError: true
      });
    }
    if(!outcome.ok){
      return makeResult(message.id, {
        content: [{type:'text', text:'MCP_TOOL_ERROR: ' + String(outcome.code || 'ERROR') + (outcome.message ? ': ' + outcome.message : '')}],
        isError: true
      });
    }
    return makeResult(message.id, {
      content: [{type:'text', text:JSON.stringify(outcome.data, null, 2)}]
    });
  }

  /* Returns {response} (a JSON-RPC response object) | {notification:true} |
     {error: <response>} for protocol-level failures. */
  async function handleMessage(message){
    switch(message.method){
      case 'initialize':
        return {response: initialize(message)};
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return {notification:true};
      case 'ping':
        return {response: makeResult(message.id, {})};
      case 'tools/list':
        return {response: makeResult(message.id, {tools: toolDefs})};
      case 'tools/call':
        return {response: await callTool(message)};
      default:
        return {error: makeError(message.id, ERROR_CODES.METHOD_NOT_FOUND, 'Method not found: ' + message.method)};
    }
  }

  return {handleMessage, isNotification};
}
