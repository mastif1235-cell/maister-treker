/* Minimal JSON Schema (2020-12 subset) validator for tool arguments.
   Supports exactly the keywords used by this server's tool schemas:
   type (object|string|number|integer|boolean|array), properties, required,
   additionalProperties:false, enum, minimum, maximum, minLength, maxLength,
   pattern, items, minItems, maxItems. Anything unsupported is a schema
   authoring error at validation time (fails closed). */

const TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array']);

function typeOf(value){
  if(value === null) return 'null';
  if(Array.isArray(value)) return 'array';
  if(typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function checkValue(schema, value, path, errors){
  if(!schema || typeof schema !== 'object' || !schema.type){
    errors.push(path + ': unsupported or missing schema definition');
    return;
  }
  const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
  for(const type of expected){
    if(!TYPES.has(type)){
      errors.push(path + ': unsupported schema type ' + type);
      return;
    }
  }
  const actual = typeOf(value);
  if(actual === 'integer' && expected.includes('number')) { /* integer satisfies number */ }
  else if(!expected.includes(actual) && !(actual === 'number' && expected.includes('integer'))){
    if(!(actual === 'integer' && expected.includes('number'))){
      errors.push(path + ': expected ' + expected.join('|') + ', got ' + actual);
      return;
    }
  }
  if(actual === 'string'){
    if(schema.minLength != null && value.length < schema.minLength) errors.push(path + ': shorter than minLength ' + schema.minLength);
    if(schema.maxLength != null && value.length > schema.maxLength) errors.push(path + ': longer than maxLength ' + schema.maxLength);
    if(schema.pattern != null && !new RegExp(schema.pattern).test(value)) errors.push(path + ': does not match pattern ' + schema.pattern);
  }
  if(actual === 'number' || actual === 'integer'){
    if(schema.minimum != null && value < schema.minimum) errors.push(path + ': below minimum ' + schema.minimum);
    if(schema.maximum != null && value > schema.maximum) errors.push(path + ': above maximum ' + schema.maximum);
  }
  if(schema.enum && !schema.enum.includes(value)){
    errors.push(path + ': must be one of ' + schema.enum.map(function(v){ return JSON.stringify(v); }).join(', '));
  }
  if(actual === 'array'){
    if(schema.minItems != null && value.length < schema.minItems) errors.push(path + ': fewer than minItems ' + schema.minItems);
    if(schema.maxItems != null && value.length > schema.maxItems) errors.push(path + ': more than maxItems ' + schema.maxItems);
    if(schema.items){
      value.forEach(function(item, index){ checkValue(schema.items, item, path + '[' + index + ']', errors); });
    }
  }
  if(actual === 'object'){
    for(const key of Object.keys(value)){
      if(!(schema.properties && key in schema.properties)){
        if(schema.additionalProperties === false) errors.push(path + '.' + key + ': unknown property');
        continue;
      }
    }
    for(const key of Object.keys(schema.properties || {})){
      const child = value[key];
      if(child === undefined){
        if((schema.required || []).includes(key)) errors.push(path + '.' + key + ': required property missing');
        continue;
      }
      checkValue(schema.properties[key], child, path + '.' + key, errors);
    }
  }
}

/* Returns {ok:true} or {ok:false, errors:[string]}. */
export function validateAgainstSchema(schema, value){
  const errors = [];
  checkValue(schema, value, 'arguments', errors);
  return errors.length ? {ok:false, errors} : {ok:true};
}
