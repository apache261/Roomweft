import { useEffect, useId, useRef, useState } from 'react';

function parseNumber(text:string,min:number,max:number) {
  const trimmed=text.trim(),value=Number(trimmed);
  const error=!trimmed?'Enter a number.':
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)||!Number.isFinite(value)?'Enter a valid number.':
    value<min||value>max?`Enter a number between ${min} and ${max}.`:'';
  return {value,error};
}

export function NumericInput({label,value,min,max,onChange}: {
  label:string;value:number;min:number;max:number;onChange:(value:number)=>void;
}) {
  const [draft,setDraft]=useState(String(value));
  const lastValue=useRef(value),input=useRef<HTMLInputElement>(null);
  const errorId=useId();
  useEffect(()=>{
    if(value!==lastValue.current)setDraft(String(value));
    lastValue.current=value;
  },[value]);
  const {error}=parseNumber(draft,min,max);
  useEffect(()=>{input.current?.setCustomValidity(error);},[error]);
  return <label className="numeric-field">{label}
    <input ref={input} data-numeric-input aria-label={label} type="text" inputMode="decimal"
      autoComplete="off" spellCheck={false} value={draft} aria-invalid={!!error}
      aria-describedby={error?errorId:undefined}
      onChange={event=>{
        const text=event.currentTarget.value;setDraft(text);
        const result=parseNumber(text,min,max);
        if(!result.error){
          lastValue.current=result.value;onChange(result.value);
        }
      }} />
    {error&&<span id={errorId} className="numeric-error" role="alert">{error}</span>}
  </label>;
}

export function firstInvalidNumericInput(root:HTMLElement|null) {
  return root?.querySelector<HTMLInputElement>('input[data-numeric-input][aria-invalid="true"]');
}
