(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.DxfJson = factory());
})(this, (function () { 'use strict';

    function isIterable(a) {
        return typeof (a === null || a === void 0 ? void 0 : a[Symbol.iterator]) === "function";
    }
    function isAsyncIterable(a) {
        return typeof (a === null || a === void 0 ? void 0 : a[Symbol.asyncIterator]) === "function";
    }
    const isPromise = (a) => {
        if (a instanceof Promise) {
            return true;
        }
        if (a !== null &&
            typeof a === "object" &&
            typeof a.then === "function" &&
            typeof a.catch === "function") {
            return true;
        }
        return false;
    };

    function sync$1(f, iterable) {
        const iterator = iterable[Symbol.iterator]();
        return {
            next() {
                const { done, value } = iterator.next();
                if (done) {
                    return {
                        done: true,
                        value: undefined,
                    };
                }
                return {
                    done: false,
                    value: f(value),
                };
            },
            [Symbol.iterator]() {
                return this;
            },
        };
    }
    function async$1(f, iterable) {
        const iterator = iterable[Symbol.asyncIterator]();
        return {
            async next(_concurrent) {
                const { done, value } = await iterator.next(_concurrent);
                if (done)
                    return { done, value };
                return {
                    done: false,
                    value: await f(value),
                };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    }
    function map(f, iterable) {
        if (iterable === undefined) {
            return (iterable) => {
                return map(f, iterable);
            };
        }
        if (isIterable(iterable)) {
            return sync$1(f, iterable);
        }
        if (isAsyncIterable(iterable)) {
            return async$1(f, iterable);
        }
        throw new TypeError("'iterable' must be type of Iterable or AsyncIterable");
    }

    /**
     * @internal
     */
    const pipe1 = (a, f) => {
        return isPromise(a) ? a.then(f) : f(a);
    };

    class AsyncFunctionException extends Error {
        constructor(message = AsyncFunctionException.MESSAGE) {
            super(message);
        }
    }
    AsyncFunctionException.MESSAGE = `'Iterable' can not used with async function.
If you want to deal with async function, see: [toAsync](https://fxts.dev/docs/toAsync)`;

    class Concurrent {
        constructor(length) {
            this.length = length;
        }
        static of(length) {
            return new Concurrent(length);
        }
    }
    const isConcurrent = (concurrent) => {
        return concurrent instanceof Concurrent;
    };
    function concurrent(length, iterable) {
        if (iterable === undefined) {
            return (iterable) => {
                return concurrent(length, iterable);
            };
        }
        if (!Number.isFinite(length) || length <= 0) {
            throw new RangeError("'length' must be positive integer");
        }
        if (!isAsyncIterable(iterable)) {
            throw new TypeError("'iterable' must be type of AsyncIterable");
        }
        const iterator = iterable[Symbol.asyncIterator]();
        const buffer = [];
        let prev = Promise.resolve();
        let nextCallCount = 0;
        let resolvedItemCount = 0;
        let finished = false;
        let pending = false;
        const settlementQueue = [];
        const consumeBuffer = () => {
            while (buffer.length > 0 && nextCallCount > resolvedItemCount) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const p = buffer.shift();
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const [resolve, reject] = settlementQueue.shift();
                if (p.status === "fulfilled") {
                    resolvedItemCount++;
                    resolve(p.value);
                    if (p.value.done) {
                        finished = true;
                    }
                }
                else {
                    reject(p.reason);
                    finished = true;
                    break;
                }
            }
        };
        const fillBuffer = () => {
            if (pending) {
                prev = prev.then(() => void (!finished && nextCallCount > resolvedItemCount && fillBuffer()));
            }
            else {
                const nextItems = Promise.allSettled(Array.from({ length }, () => iterator.next(Concurrent.of(length))));
                pending = true;
                prev = prev
                    .then(() => nextItems)
                    .then((nextItems) => {
                    buffer.push(...nextItems);
                    pending = false;
                    recur();
                });
            }
        };
        function recur() {
            if (finished || nextCallCount === resolvedItemCount) {
                return;
            }
            else if (buffer.length > 0) {
                consumeBuffer();
            }
            else {
                fillBuffer();
            }
        }
        return {
            [Symbol.asyncIterator]() {
                return this;
            },
            next() {
                nextCallCount++;
                if (finished) {
                    return { done: true, value: undefined };
                }
                return new Promise((resolve, reject) => {
                    settlementQueue.push([resolve, reject]);
                    recur();
                });
            },
        };
    }

    async function* asyncSequential(f, iterable) {
        for await (const item of iterable) {
            if (await f(item))
                yield item;
        }
    }
    function asyncConcurrent(iterable) {
        const iterator = iterable[Symbol.asyncIterator]();
        const settlementQueue = [];
        const buffer = [];
        let finished = false;
        let nextCallCount = 0;
        let resolvedCount = 0;
        let prevItem = Promise.resolve();
        function fillBuffer(concurrent) {
            const nextItem = iterator.next(concurrent);
            prevItem = prevItem
                .then(() => nextItem)
                .then(({ done, value }) => {
                if (done) {
                    while (settlementQueue.length > 0) {
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        const [resolve] = settlementQueue.shift();
                        resolve({ done: true, value: undefined });
                    }
                    return void (finished = true);
                }
                const [cond, item] = value;
                if (cond) {
                    buffer.push(item);
                }
                recur(concurrent);
            })
                .catch((reason) => {
                finished = true;
                while (settlementQueue.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    const [, reject] = settlementQueue.shift();
                    reject(reason);
                }
            });
        }
        function consumeBuffer() {
            while (buffer.length > 0 && nextCallCount > resolvedCount) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const value = buffer.shift();
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const [resolve] = settlementQueue.shift();
                resolve({ done: false, value });
                resolvedCount++;
            }
        }
        function recur(concurrent) {
            if (finished || nextCallCount === resolvedCount) {
                return;
            }
            else if (buffer.length > 0) {
                consumeBuffer();
            }
            else {
                fillBuffer(concurrent);
            }
        }
        return {
            async next(concurrent) {
                nextCallCount++;
                if (finished) {
                    return { done: true, value: undefined };
                }
                return new Promise((resolve, reject) => {
                    settlementQueue.push([resolve, reject]);
                    recur(concurrent);
                });
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    }
    function toFilterIterator(f, iterable) {
        const iterator = iterable[Symbol.asyncIterator]();
        return {
            [Symbol.asyncIterator]() {
                return this;
            },
            async next(_concurrent) {
                const { done, value } = await iterator.next(_concurrent);
                if (done) {
                    return {
                        done: true,
                        value: undefined,
                    };
                }
                return pipe1(f(value), (cond) => ({
                    done,
                    value: [Boolean(cond), value],
                }));
            },
        };
    }
    function async(f, iterable) {
        let _iterator;
        return {
            async next(_concurrent) {
                if (_iterator === undefined) {
                    _iterator = isConcurrent(_concurrent)
                        ? asyncConcurrent(concurrent(_concurrent.length, toFilterIterator(f, iterable)))
                        : asyncSequential(f, iterable);
                }
                return _iterator.next(_concurrent);
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    }
    function* sync(f, iterable) {
        for (const a of iterable) {
            const res = f(a);
            if (isPromise(res)) {
                throw new AsyncFunctionException();
            }
            if (res) {
                yield a;
            }
        }
    }
    function filter(f, iterable) {
        if (iterable === undefined) {
            return (iterable) => filter(f, iterable);
        }
        if (isIterable(iterable)) {
            return sync(f, iterable);
        }
        if (isAsyncIterable(iterable)) {
            return async(f, iterable);
        }
        throw new TypeError("'iterable' must be type of Iterable or AsyncIterable");
    }

    (H=eE||(eE={}))[H.None=0]="None",H[H.Anonymous=1]="Anonymous",H[H.NonConstant=2]="NonConstant",H[H.Xref=4]="Xref",H[H.XrefOverlay=8]="XrefOverlay",H[H.ExternallyDependent=16]="ExternallyDependent",H[H.ResolvedOrDependent=32]="ResolvedOrDependent",H[H.ReferencedXref=64]="ReferencedXref",(G=eI||(eI={}))[G.BYBLOCK=0]="BYBLOCK",G[G.BYLAYER=256]="BYLAYER";let r=-1,t=4,n=Math.PI/24;(U=eh||(eh={}))[U.Rotated=0]="Rotated",U[U.Aligned=1]="Aligned",U[U.Angular=2]="Angular",U[U.Diameter=3]="Diameter",U[U.Radius=4]="Radius",U[U.Angular3Point=5]="Angular3Point",U[U.Ordinate=6]="Ordinate",U[U.ReferenceIsExclusive=32]="ReferenceIsExclusive",U[U.IsOrdinateXTypeFlag=64]="IsOrdinateXTypeFlag",U[U.IsCustomTextPositionFlag=128]="IsCustomTextPositionFlag",(Y=ef||(ef={}))[Y.TopLeft=1]="TopLeft",Y[Y.TopCenter=2]="TopCenter",Y[Y.TopRight=3]="TopRight",Y[Y.MiddleLeft=4]="MiddleLeft",Y[Y.MiddleCenter=5]="MiddleCenter",Y[Y.MiddleRight=6]="MiddleRight",Y[Y.BottomLeft=7]="BottomLeft",Y[Y.BottomCenter=8]="BottomCenter",Y[Y.BottomRight=9]="BottomRight",(W=eb||(eb={}))[W.AtLeast=1]="AtLeast",W[W.Exact=2]="Exact",(j=eT||(eT={}))[j.Center=0]="Center",j[j.Above=1]="Above",j[j.Outside=2]="Outside",j[j.JIS=3]="JIS",j[j.Below=4]="Below",(X=eD||(eD={}))[X.Feet=0]="Feet",X[X.None=1]="None",X[X.Inch=2]="Inch",X[X.FeetAndInch=3]="FeetAndInch",X[X.Leading=4]="Leading",X[X.Trailing=8]="Trailing",X[X.LeadingAndTrailing=12]="LeadingAndTrailing",(z=eO||(eO={}))[z.None=0]="None",z[z.Leading=1]="Leading",z[z.Trailing=2]="Trailing",z[z.LeadingAndTrailing=3]="LeadingAndTrailing",(K=eS||(eS={}))[K.Center=0]="Center",K[K.Left=1]="Left",K[K.Right=2]="Right",K[K.OverFirst=3]="OverFirst",K[K.OverSecond=4]="OverSecond",(Z=eN||(eN={}))[Z.Bottom=0]="Bottom",Z[Z.Center=1]="Center",Z[Z.Top=2]="Top",(J=eg||(eg={}))[J.PatternFill=0]="PatternFill",J[J.SolidFill=1]="SolidFill",($=e_||(e_={}))[$.NonAssociative=0]="NonAssociative",$[$.Associative=1]="Associative",(q=eL||(eL={}))[q.Normal=0]="Normal",q[q.Outer=1]="Outer",q[q.Ignore=2]="Ignore",(Q=eA||(eA={}))[Q.UserDefined=0]="UserDefined",Q[Q.Predefined=1]="Predefined",Q[Q.Custom=2]="Custom",(ee=ey||(ey={}))[ee.NotAnnotated=0]="NotAnnotated",ee[ee.Annotated=1]="Annotated",(ea=eP||(eP={}))[ea.Solid=0]="Solid",ea[ea.Gradient=1]="Gradient",(er=eC||(eC={}))[er.TwoColor=0]="TwoColor",er[er.OneColor=1]="OneColor",(et=eM||(eM={}))[et.Default=0]="Default",et[et.External=1]="External",et[et.Polyline=2]="Polyline",et[et.Derived=4]="Derived",et[et.Textbox=8]="Textbox",et[et.Outermost=16]="Outermost",(en=ev||(ev={}))[en.Line=1]="Line",en[en.Circular=2]="Circular",en[en.Elliptic=3]="Elliptic",en[en.Spline=4]="Spline",(eo=eR||(eR={}))[eo.Off=0]="Off",eo[eo.Solid=1]="Solid",eo[eo.Dashed=2]="Dashed",eo[eo.Dotted=3]="Dotted",eo[eo.ShotDash=4]="ShotDash",eo[eo.MediumDash=5]="MediumDash",eo[eo.LongDash=6]="LongDash",eo[eo.DoubleShortDash=7]="DoubleShortDash",eo[eo.DoubleMediumDash=8]="DoubleMediumDash",eo[eo.DoubleLongDash=9]="DoubleLongDash",eo[eo.DoubleMediumLongDash=10]="DoubleMediumLongDash",eo[eo.SparseDot=11]="SparseDot";let o={DRAGVS:"NULL",INTERFERECOLOR:1,INTERFEREOBJVS:"Conceptual",INTERFEREVPVS:"3d Wireframe",OBSLTYPE:eR.Off,SHADEDIF:70};(es=ek||(ek={}))[es.Standard=-3]="Standard",es[es.ByLayer=-2]="ByLayer",es[es.ByBlock=-1]="ByBlock",(ei=ex||(ex={}))[ei.English=0]="English",ei[ei.Metric=1]="Metric";let s=65536;function i(e,a,r){return e.code===a&&(null==r||e.value===r)}function c(e){let a={};e.rewind();let r=e.next(),t=r.code;if(a.x=r.value,(r=e.next()).code!==t+10)throw Error("Expected code for point value to be 20 but got "+r.code+".");return (a.y=r.value,(r=e.next()).code!==t+20)?e.rewind():a.z=r.value,a}(ec=eF||(eF={}))[ec.PERSPECTIVE_MODE=1]="PERSPECTIVE_MODE",ec[ec.FRONT_CLIPPING=2]="FRONT_CLIPPING",ec[ec.BACK_CLIPPING=4]="BACK_CLIPPING",ec[ec.UCS_FOLLOW=8]="UCS_FOLLOW",ec[ec.FRONT_CLIP_NOT_AT_EYE=16]="FRONT_CLIP_NOT_AT_EYE",ec[ec.UCS_ICON_VISIBILITY=32]="UCS_ICON_VISIBILITY",ec[ec.UCS_ICON_AT_ORIGIN=64]="UCS_ICON_AT_ORIGIN",ec[ec.FAST_ZOOM=128]="FAST_ZOOM",ec[ec.SNAP_MODE=256]="SNAP_MODE",ec[ec.GRID_MODE=512]="GRID_MODE",ec[ec.ISOMETRIC_SNAP_STYLE=1024]="ISOMETRIC_SNAP_STYLE",ec[ec.HIDE_PLOT_MODE=2048]="HIDE_PLOT_MODE",ec[ec.K_ISO_PAIR_TOP=4096]="K_ISO_PAIR_TOP",ec[ec.K_ISO_PAIR_RIGHT=8192]="K_ISO_PAIR_RIGHT",ec[ec.VIEWPORT_ZOOM_LOCKING=16384]="VIEWPORT_ZOOM_LOCKING",ec[ec.UNUSED=32768]="UNUSED",ec[ec.NON_RECTANGULAR_CLIPPING=65536]="NON_RECTANGULAR_CLIPPING",ec[ec.VIEWPORT_OFF=131072]="VIEWPORT_OFF",ec[ec.GRID_BEYOND_DRAWING_LIMITS=262144]="GRID_BEYOND_DRAWING_LIMITS",ec[ec.ADAPTIVE_GRID_DISPLAY=524288]="ADAPTIVE_GRID_DISPLAY",ec[ec.SUBDIVISION_BELOW_SPACING=1048576]="SUBDIVISION_BELOW_SPACING",ec[ec.GRID_FOLLOWS_WORKPLANE=2097152]="GRID_FOLLOWS_WORKPLANE",(el=ew||(ew={}))[el.OPTIMIZED_2D=0]="OPTIMIZED_2D",el[el.WIREFRAME=1]="WIREFRAME",el[el.HIDDEN_LINE=2]="HIDDEN_LINE",el[el.FLAT_SHADED=3]="FLAT_SHADED",el[el.GOURAUD_SHADED=4]="GOURAUD_SHADED",el[el.FLAT_SHADED_WITH_WIREFRAME=5]="FLAT_SHADED_WITH_WIREFRAME",el[el.GOURAUD_SHADED_WITH_WIREFRAME=6]="GOURAUD_SHADED_WITH_WIREFRAME",(ed=eV||(eV={}))[ed.UCS_UNCHANGED=0]="UCS_UNCHANGED",ed[ed.HAS_OWN_UCS=1]="HAS_OWN_UCS",(eu=eB||(eB={}))[eu.NON_ORTHOGRAPHIC=0]="NON_ORTHOGRAPHIC",eu[eu.TOP=1]="TOP",eu[eu.BOTTOM=2]="BOTTOM",eu[eu.FRONT=3]="FRONT",eu[eu.BACK=4]="BACK",eu[eu.LEFT=5]="LEFT",eu[eu.RIGHT=6]="RIGHT",(ep=eH||(eH={}))[ep.AS_DISPLAYED=0]="AS_DISPLAYED",ep[ep.WIREFRAME=1]="WIREFRAME",ep[ep.HIDDEN=2]="HIDDEN",ep[ep.RENDERED=3]="RENDERED",(em=eG||(eG={}))[em.ONE_DISTANT_LIGHT=0]="ONE_DISTANT_LIGHT",em[em.TWO_DISTANT_LIGHTS=1]="TWO_DISTANT_LIGHTS";let l=Symbol();function d(e,a){return (r,t,n)=>{let o=e.reduce((e,a)=>{a.pushContext&&e.push({});let r=e[e.length-1];for(let e of "number"==typeof a.code?[a.code]:a.code){let t=r[e]??(r[e]=[]);a.isMultiple&&t.length&&console.warn(`Snippet ${t.at(-1).name} for code(${e}) is shadowed by ${a.name}`),t.push(a);}return e},[{}]),s=!1,c=o.length-1;for(;!i(r,0,"EOF");){let e=function(e,a,r){return e.find((e,t)=>t>=r&&e[a]?.length)}(o,r.code,c),a=e?.[r.code].at(-1);if(!e||!a){t.rewind();break}a.isMultiple||e[r.code].pop();let{name:i,parser:d,isMultiple:u}=a,p=d?.(r,t,n);if(p===l){t.rewind();break}if(i){let[e,a]=function(e,a){let r=a.split("."),t=e;for(let e=0;e<r.length-1;++e){let a=r[e];Object.hasOwn(t,a)||(t[a]={}),t=t[a];}return [t,r.at(-1)]}(n,i);u?(Object.hasOwn(e,a)||(e[a]=[]),e[a].push(p)):e[a]=p;}a.pushContext&&(c-=1),s=!0,r=t.next();}return a&&Object.setPrototypeOf(n,a),s}}function u({value:e}){return e}function p(e,a){return c(a)}function m({value:e}){return !!e}var E,I,h,f,b,T,D,O,S,N,g,_,L,A,y,P,C,M,v,R,k,x,F,w,V,B,H,G,U,Y,W,j,X,z,K,Z,J,$,q,Q,ee,ea,er,et,en,eo,es,ei,ec,el,ed,eu,ep,em,eE,eI,eh,ef,eb,eT,eD,eO,eS,eN,eg,e_,eL,eA,ey,eP,eC,eM,ev,eR,ek,ex,eF,ew,eV,eB,eH,eG,eU,eY,eW,ej,eX,ez,eK,eZ,eJ,e$,eq,eQ,e0,e1,e4,e2,e3,e7,e5,e6,e9=[0,16711680,16776960,65280,65535,255,16711935,16777215,8421504,12632256,16711680,16744319,13369344,13395558,10027008,10046540,8323072,8339263,4980736,4990502,16727808,16752511,13382400,13401958,10036736,10051404,8331008,8343359,4985600,4992806,16744192,16760703,13395456,13408614,10046464,10056268,8339200,8347455,4990464,4995366,16760576,16768895,13408512,13415014,10056192,10061132,8347392,8351551,4995328,4997670,16776960,16777087,13421568,13421670,10000384,10000460,8355584,8355647,5000192,5000230,12582656,14679935,10079232,11717734,7510016,8755276,6258432,7307071,3755008,4344870,8388352,12582783,6736896,10079334,5019648,7510092,4161280,6258495,2509824,3755046,4194048,10485631,3394560,8375398,2529280,6264908,2064128,5209919,1264640,3099686,65280,8388479,52224,6736998,38912,5019724,32512,4161343,19456,2509862,65343,8388511,52275,6737023,38950,5019743,32543,4161359,19475,2509871,65407,8388543,52326,6737049,38988,5019762,32575,4161375,19494,2509881,65471,8388575,52377,6737074,39026,5019781,32607,4161391,19513,2509890,65535,8388607,52428,6737100,39064,5019800,32639,4161407,19532,2509900,49151,8380415,39372,6730444,29336,5014936,24447,4157311,14668,2507340,32767,8372223,26316,6724044,19608,5010072,16255,4153215,9804,2505036,16383,8364031,13260,6717388,9880,5005208,8063,4149119,4940,2502476,255,8355839,204,6710988,152,5000344,127,4145023,76,2500172,4129023,10452991,3342540,8349388,2490520,6245528,2031743,5193599,1245260,3089996,8323327,12550143,6684876,10053324,4980888,7490712,4128895,6242175,2490444,3745356,12517631,14647295,10027212,11691724,7471256,8735896,6226047,7290751,3735628,4335180,16711935,16744447,13369548,13395660,9961624,9981080,8323199,8339327,4980812,4990540,16711871,16744415,13369497,13395634,9961586,9981061,8323167,8339311,4980793,4990530,16711807,16744383,13369446,13395609,9961548,9981042,8323135,8339295,4980774,4990521,16711743,16744351,13369395,13395583,9961510,9981023,8323103,8339279,4980755,4990511,3355443,5987163,8684676,11382189,14079702,16777215];function e8(e,a){if(!i(e,1001))throw Error("XData must starts with code 1001");let r={appName:e.value,value:[]};e=a.next();let t=[r.value];for(;!i(e,0,"EOF")&&e.code>=1e3;){let r=t.at(-1);switch(e.code){case 1002:"{"===e.value?t.push([]):(t.pop(),t.at(-1)?.push(r));break;case 1e3:case 1004:case 1040:case 1070:case 1071:r.push({type:ae(e.code),value:e.value});break;case 1003:r.push({name:"layer",type:ae(e.code),value:e.value});break;case 1005:r.push({name:"handle",type:ae(e.code),value:e.value});break;case 1010:r.push({type:ae(e.code),value:c(a)});break;case 1011:r.push({name:"worldSpacePosition",type:ae(e.code),value:c(a)});break;case 1012:r.push({name:"worldSpaceDisplacement",type:ae(e.code),value:c(a)});break;case 1013:r.push({name:"worldSpaceDirection",type:ae(e.code),value:c(a)});break;case 1041:r.push({name:"distance",type:ae(e.code),value:e.value});break;case 1042:r.push({name:"scale",type:ae(e.code),value:e.value});}e=a.next();}return a.rewind(),r}function ae(e){switch(e){case 1e3:case 1003:case 1005:return "string";case 1004:return "hex";case 1040:case 1041:case 1042:return "real";case 1070:return "integer";case 1071:return "long";case 1010:case 1011:case 1012:case 1013:return "point";default:return ""}}function aa(e,a,r){if(i(a,102))return ao(a,r),!0;switch(a.code){case 0:e.type=a.value;break;case 5:e.handle=a.value;break;case 330:e.ownerDictionarySoftId?e.ownerBlockRecordSoftId=a.value:e.ownerDictionarySoftId=a.value;break;case 360:e.ownerdictionaryHardId=a.value;break;case 67:e.isInPaperSpace=!!a.value;break;case 8:e.layer=a.value;break;case 6:e.lineType=a.value;break;case 347:e.materialObjectHardId=a.value;break;case 62:e.colorIndex=a.value,e.color=e9[Math.abs(a.value)];break;case 370:e.lineweight=a.value;break;case 48:e.lineTypeScale=a.value;break;case 60:e.isVisible=!!a.value;break;case 92:e.proxyByte=a.value;break;case 310:e.proxyEntity=a.value;break;case 100:break;case 420:e.color=a.value;break;case 430:e.transparency=a.value;break;case 390:e.plotStyleHardId=a.value;break;case 284:e.shadowMode=a.value;break;case 1001:e.xdata=e8(a,r);break;default:return !1}return !0}let ar=0;function at(e){if(!e)throw TypeError("entity cannot be undefined or null");e.handle||(e.handle=ar++);}(E=eU||(eU={}))[E.CAST_AND_RECEIVE=0]="CAST_AND_RECEIVE",E[E.CAST=1]="CAST",E[E.RECEIVE=2]="RECEIVE",E[E.IGNORE=3]="IGNORE";let an=[{code:1001,name:"xdata",parser:e8},{code:284,name:"shadowMode",parser:u},{code:390,name:"plotStyleHardId",parser:u},{code:440,name:"transparency",parser:u},{code:430,name:"colorName",parser:u},{code:420,name:"color",parser:u},{code:310,name:"proxyEntity",parser:u},{code:92,name:"proxyByte",parser:u},{code:60,name:"isVisible",parser:m},{code:48,name:"lineTypeScale",parser:u},{code:370,name:"lineweight",parser:u},{code:62,name:"colorIndex",parser(e,a,r){let t=e.value;return r.color=e9[Math.abs(t)],t}},{code:347,name:"materialObjectHardId",parser:u},{code:6,name:"lineType",parser:u},{code:8,name:"layer",parser:u},{code:410,name:"layoutTabName",parser:u},{code:67,name:"isInPaperSpace",parser:m},{code:100},{code:330,name:"ownerBlockRecordSoftId",parser:u},{code:102,parser:ao},{code:102,parser:ao},{code:102,parser:ao},{code:5,name:"handle",parser:u}];function ao(e,a){for(e=a.next();!i(e,102)&&!i(e,0,"EOF");)e=a.next();}function as(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}let ai={extrusionDirection:{x:0,y:0,z:1}},ac=[{code:210,name:"extrusionDirection",parser:p},{code:51,name:"endAngle",parser:u},{code:50,name:"startAngle",parser:u},{code:100,name:"subclassMarker",parser:u},{code:40,name:"radius",parser:u},{code:10,name:"center",parser:p},{code:39,name:"thickness",parser:u},{code:100},...an];class al{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){as(this,"parser",d(ac,ai));}}function ad(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}as(al,"ForEntityName","ARC"),(I=eY||(eY={}))[I.NONE=0]="NONE",I[I.INVISIBLE=1]="INVISIBLE",I[I.CONSTANT=2]="CONSTANT",I[I.VERIFICATION_REQUIRED=4]="VERIFICATION_REQUIRED",I[I.PRESET=8]="PRESET",(h=eW||(eW={}))[h.MULTILINE=2]="MULTILINE",h[h.CONSTANT_MULTILINE=4]="CONSTANT_MULTILINE",(f=ej||(ej={}))[f.NONE=0]="NONE",f[f.MIRRORED_X=2]="MIRRORED_X",f[f.MIRRORED_Y=4]="MIRRORED_Y",(b=eX||(eX={}))[b.LEFT=0]="LEFT",b[b.CENTER=1]="CENTER",b[b.RIGHT=2]="RIGHT",b[b.ALIGNED=3]="ALIGNED",b[b.MIDDLE=4]="MIDDLE",b[b.FIT=5]="FIT",(T=ez||(ez={}))[T.BASELINE=0]="BASELINE",T[T.BOTTOM=1]="BOTTOM",T[T.MIDDLE=2]="MIDDLE",T[T.TOP=3]="TOP";let au={thickness:0,rotation:0,xScale:1,obliqueAngle:0,styleName:"STANDARD",generationFlag:0,halign:eX.LEFT,valign:ez.BASELINE,extrusionDirection:{x:0,y:0,z:1}},ap=[{code:73,name:"valign",parser:u},{code:100},{code:210,name:"extrusionDirection",parser:p},{code:11,name:"endPoint",parser:p},{code:72,name:"valign",parser:u},{code:72,name:"halign",parser:u},{code:71,name:"generationFlag",parser:u},{code:7,name:"styleName",parser:u},{code:51,name:"obliqueAngle",parser:u},{code:41,name:"xScale",parser:u},{code:50,name:"rotation",parser:u},{code:1,name:"text",parser:u},{code:40,name:"textHeight",parser:u},{code:10,name:"startPoint",parser:p},{code:39,name:"thickness",parser:u},{code:100,name:"subclassMarker",parser:u},...an];class am{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){ad(this,"parser",d(ap,au));}}function aE(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}ad(am,"ForEntityName","TEXT");let aI={...au},ah=[{code:2},{code:40,name:"annotationScale",parser:u},{code:10,name:"alignmentPoint",parser:p},{code:340,name:"secondaryAttributesHardIds",isMultiple:!0,parser:u},{code:70,name:"numberOfSecondaryAttributes",parser:u},{code:70,name:"isReallyLocked",parser:m},{code:70,name:"mtextFlag",parser:u},{code:280,name:"isDuplicatedRecord",parser:m},{code:100},{code:280,name:"isLocked",parser:m},{code:74,name:"valign",parser:u},{code:73},{code:70,name:"attributeFlag",parser:u},{code:2,name:"tag",parser:u},{code:3,name:"prompt",parser:u},{code:280},{code:100,name:"subclassMarker",parser:u},...ap.slice(2)];class af{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){aE(this,"parser",d(ah,aI));}}function ab(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}aE(af,"ForEntityName","ATTDEF");let aT={thickness:0,extrusionDirection:{x:0,y:0,z:1}},aD=[{code:210,name:"extrusionDirection",parser:p},{code:40,name:"radius",parser:u},{code:10,name:"center",parser:p},{code:39,name:"thickness",parser:u},{code:100,name:"subclassMarker",parser:u},...an];class aO{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){ab(this,"parser",d(aD,aT));}}ab(aO,"ForEntityName","CIRCLE");class aS{parseEntity(e,a){let r={};for(;!i(a,0,"EOF");){if(0===a.code){e.rewind();break}!function(e,a,r){switch(a.code){case 100:e.subclassMarker=a.value;break;case 280:e.version=a.value;break;case 2:e.name=a.value;break;case 10:e.definitionPoint=c(r);break;case 11:e.textPoint=c(r);break;case 12:e.insertionPoint=c(r);break;case 13:e.subDefinitionPoint1=c(r);break;case 14:e.subDefinitionPoint2=c(r);break;case 15:e.centerPoint=c(r);break;case 16:e.arcPoint=c(r);break;case 70:e.dimensionType=a.value;break;case 71:e.attachmentPoint=a.value;break;case 72:e.textLineSpacingStyle=a.value;break;case 40:e.leaderLength=a.value;break;case 41:e.textLineSpacingFactor=a.value;break;case 42:e.measurement=a.value;break;case 1:e.text=a.value;break;case 50:e.rotationAngle=a.value;break;case 52:e.obliqueAngle=a.value;break;case 53:e.textRotation=a.value;break;case 51:e.ocsRotation=a.value;break;case 210:e.extrusionDirection=c(r);break;case 3:e.styleName=a.value;break;default:aa(e,a,r);}}(r,a,e),a=e.next();}return r}}function aN(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}O="DIMENSION",(D="ForEntityName")in aS?Object.defineProperty(aS,D,{value:O,enumerable:!0,configurable:!0,writable:!0}):aS[D]=O;let ag={extrusionDirection:{x:0,y:0,z:1}},a_=[{code:42,name:"endAngle",parser:u},{code:41,name:"startAngle",parser:u},{code:40,name:"axisRatio",parser:u},{code:210,name:"extrusionDirection",parser:p},{code:11,name:"majorAxisEndPoint",parser:p},{code:10,name:"center",parser:p},{code:100,name:"subclassMarker",parser:u},...an];class aL{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){aN(this,"parser",d(a_,ag));}}aN(aL,"ForEntityName","ELLIPSE");let aA=[{code:330,name:"sourceBoundaryObjects",parser:u,isMultiple:!0},{code:97,name:"numberOfSourceBoundaryObjects",parser:u}],ay=[{code:11,name:"end",parser:p},{code:10,name:"start",parser:p}],aP=[{code:73,name:"isCCW",parser:m},{code:51,name:"endAngle",parser:u},{code:50,name:"startAngle",parser:u},{code:40,name:"radius",parser:u},{code:10,name:"center",parser:p}],aC=[{code:73,name:"isCCW",parser:m},{code:51,name:"endAngle",parser:u},{code:50,name:"startAngle",parser:u},{code:40,name:"lengthOfMinorAxis",parser:u},{code:11,name:"end",parser:p},{code:10,name:"center",parser:p}],aM=[{code:13,name:"endTangent",parser:p},{code:12,name:"startTangent",parser:p},{code:11,name:"fitDatum",isMultiple:!0,parser:p},{code:97,name:"numberOfFitData",parser:u},{code:10,name:"controlPoints",isMultiple:!0,parser(e,a){let r={...c(a),weight:1};return 42===(e=a.next()).code?r.weight=e.value:a.rewind(),r}},{code:40,name:"knots",isMultiple:!0,parser:u},{code:96,name:"numberOfControlPoints",parser:u},{code:95,name:"numberOfKnots",parser:u},{code:74,name:"isPeriodic",parser:m},{code:73,name:"splineFlag",parser:u},{code:94,name:"degree",parser:u}],av={[ev.Line]:ay,[ev.Circular]:aP,[ev.Elliptic]:aC,[ev.Spline]:aM},aR=[...aA,{code:72,name:"edges",parser(e,a){let r={type:e.value},t=d(av[r.type]);if(!t)throw Error(`Invalid edge type ${r.type}`);return t(e=a.next(),a,r),r},isMultiple:!0},{code:93,name:"numberOfEdges",parser:u}],ak=[...aA,{code:10,name:"vertices",parser(e,a){let r={...c(a),bulge:0};return 42===(e=a.next()).code?r.bulge=e.value:a.rewind(),r},isMultiple:!0},{code:93,name:"numberOfVertices",parser:u},{code:73,name:"isClosed",parser:m},{code:72,name:"hasBulge",parser:m}],ax=[{code:49,name:"dashLengths",parser:u,isMultiple:!0},{code:79,name:"numberOfDashLengths",parser:u},{code:45,name:"offset",parser:aF},{code:43,name:"base",parser:aF},{code:53,name:"angle",parser:u}];function aF(e,a){let r=e.code+1,t={x:e.value,y:1};return (e=a.next()).code===r?t.y=e.value:a.rewind(),t}function aw(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}let aV={extrusionDirection:{x:0,y:0,z:1},gradientRotation:0,colorTint:0},aB=[{code:470},{code:463},{code:462,name:"colorTint",parser:u},{code:461,name:"gradientDefinition",parser:u},{code:460,name:"gradientRotation",parser:u},{code:453,name:"numberOfColors",parser:u},{code:452,name:"gradientColorFlag",parser:u},{code:451},{code:450,name:"gradientFlag",parser:u},{code:10,name:"seedPoints",parser:p,isMultiple:!0},{code:99},{code:11,name:"offsetVector",parser:p},{code:98,name:"numberOfSeedPoints",parser:u},{code:47,name:"pixelSize",parser:u},{code:53,name:"definitionLines",parser:function(e,a){let r={};return d(ax)(e,a,r),r},isMultiple:!0},{code:78,name:"numberOfDefinitionLines",parser:u},{code:77,name:"isDouble",parser:m},{code:73,name:"isAnnotated",parser:m},{code:41,name:"patternScale",parser:u},{code:52,name:"patternAngle",parser:u},{code:76,name:"patternType",parser:u},{code:75,name:"hatchStyle",parser:u},{code:92,name:"boundaryPaths",parser:function(e,a){let r={boundaryPathTypeFlag:e.value},t=r.boundaryPathTypeFlag&eM.Polyline;return (e=a.next(),t)?d(ak)(e,a,r):d(aR)(e,a,r),r},isMultiple:!0},{code:91,name:"numberOfBoundaryPaths",parser:u},{code:71,name:"associativity",parser:u},{code:63,name:"patternFillColor",parser:u},{code:70,name:"solidFill",parser:u},{code:2,name:"patternName",parser:u},{code:210,name:"extrusionDirection",parser:p},{code:10,name:"elevationPoint",parser:p},{code:100,name:"subclassMarker",parser:u,pushContext:!0},...an];class aH{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){aw(this,"parser",d(aB,aV));}}function aG(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}aw(aH,"ForEntityName","HATCH");let aU={xScale:1,yScale:1,zScale:1,rotation:0,columnCount:0,rowCount:0,columnSpacing:0,rowSpacing:0,extrusionDirection:{x:0,y:0,z:1}},aY=[{code:210,name:"extrusionDirection",parser:p},{code:45,name:"rowSpacing",parser:u},{code:44,name:"columnSpacing",parser:u},{code:71,name:"rowCount",parser:u},{code:70,name:"columnCount",parser:u},{code:50,name:"rotation",parser:u},{code:43,name:"zScale",parser:u},{code:42,name:"yScale",parser:u},{code:41,name:"xScale",parser:u},{code:10,name:"insertionPoint",parser:p},{code:2,name:"name",parser:u},{code:66,name:"isVariableAttributes",parser:m},{code:100,name:"subclassMarker",parser:u},...an];class aW{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){aG(this,"parser",d(aY,aU));}}function aj(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}aG(aW,"ForEntityName","INSERT");let aX={isArrowheadEnabled:!0},az=[{code:213,name:"offsetFromAnnotation",parser:p},{code:212,name:"offsetFromBlock",parser:p},{code:211,name:"horizontalDirection",parser:p},{code:210,name:"normal",parser:p},{code:340,name:"associatedAnnotation",parser:u},{code:77,name:"byBlockColor",parser:u},{code:10,name:"vertices",parser:p,isMultiple:!0},{code:76,name:"numberOfVertices",parser:u},{code:41,name:"textWidth",parser:u},{code:40,name:"textHeight",parser:u},{code:75,name:"isHooklineExists",parser:m},{code:74,name:"isHooklineSameDirection",parser:m},{code:73,name:"leaderCreationFlag",parser:u},{code:72,name:"isSpline",parser:m},{code:71,name:"isArrowheadEnabled",parser:m},{code:3,name:"styleName",parser:u},{code:100,name:"subclassMarker",parser:u},...an];class aK{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){aj(this,"parser",d(az,aX));}}function aZ(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}aj(aK,"ForEntityName","LEADER"),(S=eK||(eK={}))[S.TextAnnotation=0]="TextAnnotation",S[S.ToleranceAnnotation=1]="ToleranceAnnotation",S[S.BlockReferenceAnnotation=2]="BlockReferenceAnnotation",S[S.NoAnnotation=3]="NoAnnotation";let aJ={thickness:0,extrusionDirection:{x:0,y:0,z:1}},a$=[{code:210,name:"extrusionDirection",parser:p},{code:11,name:"endPoint",parser:p},{code:10,name:"startPoint",parser:p},{code:39,name:"thickness",parser:u},{code:100,name:"subclassMarker",parser:u},...an];class aq{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){aZ(this,"parser",d(a$,aJ));}}aZ(aq,"ForEntityName","LINE"),(N=eZ||(eZ={}))[N.IS_CLOSED=1]="IS_CLOSED",N[N.PLINE_GEN=128]="PLINE_GEN";let aQ={flag:0,elevation:0,thickness:0,extrusionDirection:{x:0,y:0,z:1},vertices:[]},a0={bulge:0},a1=[{code:42,name:"bulge",parser:u},{code:41,name:"endWidth",parser:u},{code:40,name:"startWidth",parser:u},{code:91,name:"id",parser:u},{code:20,name:"y",parser:u},{code:10,name:"x",parser:u}],a4=[{code:210,name:"extrusionDirection",parser:p},{code:10,name:"vertices",isMultiple:!0,parser(e,a){let r={};return d(a1,a0)(e,a,r),r}},{code:39,name:"thickness",parser:u},{code:38,name:"elevation",parser:u},{code:43,name:"constantWidth",parser:u},{code:70,name:"flag",parser:u},{code:90,name:"numberOfVertices",parser:u},{code:100,name:"subclassMarker",parser:u},...an];class a2{parseEntity(e,a){let r={};return d(a4,aQ)(a,e,r),r}}function a3({seeds:e,spanner:a,serializer:r,iterationLimit:t=1/0}){let n=new Set,o=0;return e.map(e=>{let s=[],i=[[e,r(e)]];for(;i.length&&o++<t;){let[e,t]=i.pop();if(!n.has(t))for(let o of(n.add(t),s.push(e),a(e)))i.push([o,r(o)]);}return s}).filter(e=>e.length)}function a7(e,a){let r={};for(let t of e){let e=a(t);null!=e&&(r[e]??(r[e]=[]),r[e].push(t));}return r}function*a5(e,a=1/0,r=1){for(let t=e;t!==a;t+=r)yield t;}function a6(e){return {x:e.x??0,y:e.y??0,z:e.z??0}}function a9(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}_="LWPOLYLINE",(g="ForEntityName")in a2?Object.defineProperty(a2,g,{value:_,enumerable:!0,configurable:!0,writable:!0}):a2[g]=_,(L=eJ||(eJ={}))[L.LEFT_TO_RIGHT=1]="LEFT_TO_RIGHT",L[L.TOP_TO_BOTTOM=3]="TOP_TO_BOTTOM",L[L.BY_STYLE=5]="BY_STYLE";let a8={textStyle:"STANDARD",extrusionDirection:{x:0,y:0,z:1},rotation:0},re=[{code:46,name:"annotationHeight",parser:u},{code:101,parser(e,a){!function(e){e.rewind();let a=e.next();if(101!==a.code)throw Error("Bad call for skipEmbeddedObject()");do a=e.next();while(0!==a.code);e.rewind();}(a);}},{code:50,name:"columnHeight",parser:u},{code:49,name:"columnGutter",parser:u},{code:48,name:"columnWidth",parser:u},{code:79,name:"columnAutoHeight",parser:u},{code:78,name:"columnFlowReversed",parser:u},{code:76,name:"columnCount",parser:u},{code:75,name:"columnType",parser:u},{code:441,name:"backgroundFillTransparency",parser:u},{code:63,name:"backgroundFillColor",parser:u},{code:45,name:"fillBoxScale",parser:u},{code:[...a5(430,440)],name:"backgroundColor",parser:u},{code:[...a5(420,430)],name:"backgroundColor",parser:u},{code:90,name:"backgroundFill",parser:u},{code:44,name:"lineSpacing",parser:u},{code:73,name:"lineSpacingStyle",parser:u},{code:50,name:"rotation",parser:u},{code:43},{code:42},{code:11,name:"direction",parser:p},{code:210,name:"extrusionDirection",parser:p},{code:7,name:"styleName",parser:u},{code:3,name:"text",parser:(e,a,r)=>(r.text??"")+e.value},{code:1,name:"text",parser:u},{code:72,name:"drawingDirection",parser:u},{code:71,name:"attachmentPoint",parser:u},{code:41,name:"width",parser:u},{code:40,name:"height",parser:u},{code:10,name:"insertionPoint",parser:p},{code:100,name:"subclassMarker",parser:u},...an];class ra{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){a9(this,"parser",d(re,a8));}}function rr(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}a9(ra,"ForEntityName","MTEXT");let rt={thickness:0,extrusionDirection:{x:0,y:0,z:1},angle:0},rn=[{code:50,name:"angle",parser:u},{code:210,name:"extrusionDirection",parser:p},{code:39,name:"thickness",parser:u},{code:10,name:"position",parser:p},{code:100,name:"subclassMarker",parser:u},...an];class ro{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){rr(this,"parser",d(rn,rt));}}function rs(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}rr(ro,"ForEntityName","POINT"),(A=e$||(e$={}))[A.CLOSED_POLYLINE=1]="CLOSED_POLYLINE",A[A.CURVE_FIT=2]="CURVE_FIT",A[A.SPLINE_FIT=4]="SPLINE_FIT",A[A.POLYLINE_3D=8]="POLYLINE_3D",A[A.POLYGON_3D=16]="POLYGON_3D",A[A.CLOSED_POLYGON=32]="CLOSED_POLYGON",A[A.POLYFACE=64]="POLYFACE",A[A.CONTINUOUS=128]="CONTINUOUS",(y=eq||(eq={}))[y.NONE=0]="NONE",y[y.QUADRATIC=5]="QUADRATIC",y[y.CUBIC=6]="CUBIC",y[y.BEZIER=8]="BEZIER",(P=eQ||(eQ={}))[P.CREATED_BY_CURVE_FIT=1]="CREATED_BY_CURVE_FIT",P[P.TANGENT_DEFINED=2]="TANGENT_DEFINED",P[P.NOT_USED=4]="NOT_USED",P[P.CREATED_BY_SPLINE_FIT=8]="CREATED_BY_SPLINE_FIT",P[P.SPLINE_CONTROL_POINT=16]="SPLINE_CONTROL_POINT",P[P.FOR_POLYLINE=32]="FOR_POLYLINE",P[P.FOR_POLYGON=64]="FOR_POLYGON",P[P.POLYFACE=128]="POLYFACE";let ri={startWidth:0,endWidth:0,bulge:0},rc=[{code:91,name:"id",parser:u},{code:[...a5(71,75)],name:"faces",isMultiple:!0,parser:u},{code:50,name:"tangentDirection",parser:u},{code:70,name:"flag",parser:u},{code:42,name:"bulge",parser:u},{code:41,name:"endWidth",parser:u},{code:40,name:"startWidth",parser:u},{code:30,name:"z",parser:u},{code:20,name:"y",parser:u},{code:10,name:"x",parser:u},{code:100,name:"subclassMarker",parser:u},{code:100},...an];class rl{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){rs(this,"parser",d(rc,ri));}}function rd(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}rs(rl,"ForEntityName","VERTEX");let ru={thickness:0,flag:0,startWidth:0,endWidth:0,meshMVertexCount:0,meshNVertexCount:0,surfaceMDensity:0,surfaceNDensity:0,smoothType:0,extrusionDirection:{x:0,y:0,z:1},vertices:[]},rp=[{code:0,name:"vertices",isMultiple:!0,parser:(e,a)=>i(e,0,"VERTEX")?(e=a.next(),new rl().parseEntity(a,e)):l},{code:210,name:"extrusionDirection",parser:p},{code:75,name:"smoothType",parser:u},{code:74,name:"surfaceNDensity",parser:u},{code:73,name:"surfaceMDensity",parser:u},{code:72,name:"meshNVertexCount",parser:u},{code:71,name:"meshMVertexCount",parser:u},{code:41,name:"endWidth",parser:u},{code:40,name:"startWidth",parser:u},{code:70,name:"flag",parser:u},{code:39,name:"thickness",parser:u},{code:30,name:"elevation",parser:u},{code:20},{code:10},{code:66},{code:100,name:"subclassMarker",parser:u},...an];class rm{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){rd(this,"parser",d(rp,ru));}}function rE(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}rd(rm,"ForEntityName","POLYLINE");let rI={vertices:[],backLineVertices:[]},rh=[{code:360,name:"geometrySettingHardId",parser:u},{code:12,name:"backLineVertices",isMultiple:!0,parser:p},{code:93,name:"numberOfBackLineVertices",parser:u},{code:11,name:"vertices",isMultiple:!0,parser:p},{code:92,name:"verticesCount",parser:u},{code:[63,411],name:"indicatorColor",parser:u},{code:70,name:"indicatorTransparency",parser:u},{code:41,name:"bottomHeight",parser:u},{code:40,name:"topHeight",parser:u},{code:10,name:"verticalDirection",parser:p},{code:1,name:"name",parser:u},{code:91,name:"flag",parser:u},{code:90,name:"state",parser:u},{code:100,name:"subclassMarker",parser:u},...an];class rf{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){rE(this,"parser",d(rh,rI));}}function rb(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}rE(rf,"ForEntityName","SECTION");let rT={points:[],thickness:0,extrusionDirection:{x:0,y:0,z:1}},rD=[{code:210,name:"extrusionDirection",parser:p},{code:39,name:"thickness",parser:u},{code:[...a5(10,14)],name:"points",isMultiple:!0,parser:p},{code:100,name:"subclassMarker",parser:u},...an];class rO{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){rb(this,"parser",d(rD,rT));}}function rS(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}rb(rO,"ForEntityName","SOLID"),(C=e0||(e0={}))[C.NONE=0]="NONE",C[C.CLOSED=1]="CLOSED",C[C.PERIODIC=2]="PERIODIC",C[C.RATIONAL=4]="RATIONAL",C[C.PLANAR=8]="PLANAR",C[C.LINEAR=16]="LINEAR";let rN={knotTolerance:1e-6,controlTolerance:1e-6,fitTolerance:1e-9,knotValues:[],controlPoints:[],fitPoints:[]},rg=[{code:11,name:"fitPoints",isMultiple:!0,parser:p},{code:10,name:"controlPoints",isMultiple:!0,parser:p},{code:41,name:"weights",isMultiple:!0,parser:u},{code:40,name:"knots",isMultiple:!0,parser:u},{code:13,name:"endTangent",parser:p},{code:12,name:"startTangent",parser:p},{code:44,name:"fitTolerance",parser:u},{code:43,name:"controlTolerance",parser:u},{code:42,name:"knotTolerance",parser:u},{code:74,name:"numberOfFitPoints",parser:u},{code:73,name:"numberOfControlPoints",parser:u},{code:72,name:"numberOfKnots",parser:u},{code:71,name:"degree",parser:u},{code:70,name:"flag",parser:u},{code:210,name:"normal",parser:p},{code:100,name:"subclassMarker",parser:u},...an];class r_{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){rS(this,"parser",d(rg,rN));}}rS(r_,"ForEntityName","SPLINE");class rL{parseEntity(e,a){let r={};for(;"EOF"!==a;){if(0===a.code){e.rewind();break}!function(e,a,r){if("EOF"===r)return !1;switch(r.code){case 0:return !1;case 100:e.subclassMarker=r.value;break;case 10:e.viewportCenter=a6(c(a));break;case 40:e.width=r.value;break;case 41:e.height=r.value;break;case 68:e.status=r.value;break;case 69:e.viewportId=r.value;break;case 12:e.displayCenter=c(a);break;case 13:e.snapBase=c(a);break;case 14:e.snapSpacing=c(a);break;case 15:e.gridSpacing=c(a);break;case 16:e.viewDirection=a6(c(a));break;case 17:e.targetPoint=a6(c(a));break;case 42:e.perspectiveLensLength=r.value;break;case 43:e.frontClipZ=r.value;break;case 44:e.backClipZ=r.value;break;case 45:e.viewHeight=r.value;break;case 50:e.snapAngle=r.value;break;case 51:e.viewTwistAngle=r.value;break;case 72:e.circleZoomPercent=r.value;break;case 331:e.frozenLayerIds??(e.frozenLayerIds=[]),e.frozenLayerIds.push(r.value);break;case 90:e.statusBitFlags=r.value;break;case 340:e.clippingBoundaryId=r.value;break;case 1:e.sheetName=r.value;break;case 281:e.renderMode=r.value;break;case 71:e.ucsPerViewport=r.value;break;case 110:e.ucsOrigin=a6(c(a));break;case 111:e.ucsXAxis=a6(c(a));break;case 112:e.ucsYAxis=a6(c(a));break;case 345:e.ucsId=r.value;break;case 346:e.ucsBaseId=r.value;break;case 79:e.orthographicType=r.value;break;case 146:e.elevation=r.value;break;case 170:e.shadePlotMode=r.value;break;case 61:e.majorGridFrequency=r.value;break;case 332:e.backgroundId=r.value;break;case 333:e.shadePlotId=r.value;break;case 348:e.visualStyleId=r.value;break;case 292:e.isDefaultLighting=!!r.value;break;case 282:e.defaultLightingType=r.value;break;case 141:e.brightness=r.value;break;case 142:e.contrast=r.value;break;case 63:case 421:case 431:e.ambientLightColor=r.value;break;case 361:e.sunId=r.value;break;case 335:case 343:case 344:case 91:e.softPointer=r.value;}return !0}(r,e,a)&&aa(r,a,e),a=e.next();}return r}}function rA(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}v="VIEWPORT",(M="ForEntityName")in rL?Object.defineProperty(rL,M,{value:v,enumerable:!0,configurable:!0,writable:!0}):rL[M]=v,(R=e1||(e1={}))[R.INVISIBLE=1]="INVISIBLE",R[R.CONSTANT=2]="CONSTANT",R[R.REQUIRE_VERIFICATION=4]="REQUIRE_VERIFICATION",R[R.PRESET=8]="PRESET";let ry={thickness:0,rotation:0,scale:1,obliqueAngle:0,textStyle:"STANDARD",textGenerationFlag:0,horizontalJustification:0,verticalJustification:0,extrusionDirection:{x:0,y:0,z:1}},rP=[...re.slice(re.findIndex(({name:e})=>"columnType"===e),re.findIndex(({name:e})=>"subclassMarker"===e)+1),{code:100},{code:0,parser(e){if(!i(e,0,"MTEXT"))return l}},{code:2,name:"definitionTag",parser:u},{code:40,name:"annotationScale",parser:u},{code:10,name:"alignmentPoint",parser:p},{code:340,name:"secondaryAttributesHardId",parser:u},{code:70,name:"numberOfSecondaryAttributes",parser:u},{code:70,name:"isReallyLocked",parser:m},{code:70,name:"mtextFlag",parser:u},{code:280,name:"isDuplicatedEntriesKeep",parser:m},{code:100},{code:280,name:"lockPositionFlag",parser:m},{code:210,name:"extrusionDirection",parser:p},{code:11,name:"alignmentPoint",parser:p},{code:74,name:"verticalJustification",parser:u},{code:72,name:"horizontalJustification",parser:u},{code:71,name:"textGenerationFlag",parser:u},{code:7,name:"textStyle",parser:u},{code:51,name:"obliqueAngle",parser:u},{code:41,name:"scale",parser:u},{code:50,name:"rotation",parser:u},{code:73},{code:70,name:"attributeFlag",parser:u},{code:2,name:"tag",parser:u},{code:280},{code:100,name:"subclassMarker",parser:u},{code:1,name:"text",parser:u},{code:40,name:"textHeight",parser:u},{code:10,name:"startPoint",parser:p},{code:39,name:"thickness",parser:u},{code:100},...an];class rC{parseEntity(e,a){let r={};return this.parser(a,e,r),r}constructor(){rA(this,"parser",d(rP,ry));}}rA(rC,"ForEntityName","ATTRIB");let rM=Object.fromEntries([al,af,rC,aO,aS,aL,aW,aK,aq,a2,ra,ro,rm,rf,rO,r_,am,aH,rL].map(e=>[e.ForEntityName,new e]));function rv(e,a){let r=[];for(;!i(e,0,"EOF");){if(0===e.code){if("ENDBLK"===e.value||"ENDSEC"===e.value){a.rewind();break}let t=rM[e.value];if(t){let n=e.value;e=a.next();let o=t.parseEntity(a,e);o.type=n,at(o),r.push(o);}else console.warn(`Unsupported ENTITY type: ${e.value}`);}e=a.next();}return r}function rR(e,a){let r={};for(;!i(e,0,"EOF")&&!i(e,0,"ENDSEC");){if(i(e,0,"BLOCK")){let t=rk(e=a.next(),a);at(t),t.name&&(r[t.name]=t);}e=a.next();}return r}function rk(e,a){let r={};for(;!i(e,0,"EOF");){if(i(e,0,"ENDBLK")){for(e=a.next();!i(e,0,"EOF");){if(i(e,100,"AcDbBlockEnd"))return r;e=a.next();}break}switch(e.code){case 1:r.xrefPath=e.value;break;case 2:r.name=e.value;break;case 3:r.name2=e.value;break;case 5:r.handle=e.value;break;case 8:r.layer=e.value;break;case 10:r.position=c(a);break;case 67:r.paperSpace=!!e.value&&1==e.value;break;case 70:0!==e.value&&(r.type=e.value);break;case 100:break;case 330:r.ownerHandle=e.value;break;case 0:r.entities=rv(e,a);}e=a.next();}return r}function rx(e,a){let r=null,t={};for(;!i(e,0,"EOF")&&!i(e,0,"ENDSEC");)9===e.code?r=e.value:10===e.code?t[r]=c(a):t[r]=e.value,e=a.next();return t}let rF=[{code:333,name:"shadePlotId",parser:u},{code:149,name:"imageOriginY",parser:u},{code:148,name:"imageOriginX",parser:u},{code:147,name:"scaleFactor",parser:u},{code:78,name:"shadePlotCustomDPI",parser:u},{code:77,name:"shadePlotResolution",parser:u},{code:76,name:"shadePlotMode",parser:u},{code:75,name:"standardScaleType",parser:u},{code:7,name:"currentStyleSheet",parser:u},{code:74,name:"plotType",parser:u},{code:73,name:"plotRotation",parser:u},{code:72,name:"paperUnit",parser:u},{code:70,name:"layoutFlag",parser:u},{code:143,name:"printScaleDenominator",parser:u},{code:142,name:"printScaleNominator",parser:u},{code:141,name:"windowAreaYMax",parser:u},{code:140,name:"windowAreaYMin",parser:u},{code:49,name:"windowAreaXMax",parser:u},{code:48,name:"windowAreaXMin",parser:u},{code:47,name:"plotOriginY",parser:u},{code:46,name:"plotOriginX",parser:u},{code:45,name:"paperHeight",parser:u},{code:44,name:"paperWidth",parser:u},{code:43,name:"marginTop",parser:u},{code:42,name:"marginRight",parser:u},{code:41,name:"marginBottom",parser:u},{code:40,name:"marginLeft",parser:u},{code:6,name:"plotViewName",parser:u},{code:4,name:"paperSize",parser:u},{code:2,name:"configName",parser:u},{code:1,name:"pageSetupName",parser:u},{code:100,name:"subclassMarker",parser:u}];(k=e4||(e4={}))[k.INCHES=0]="INCHES",k[k.MILLIMETERS=1]="MILLIMETERS",k[k.PIXELS=2]="PIXELS",(x=e2||(e2={}))[x.LAST_SCREEN_DISPLAY=0]="LAST_SCREEN_DISPLAY",x[x.DRAWING_EXTENTS=1]="DRAWING_EXTENTS",x[x.DRAWING_LIMITS=2]="DRAWING_LIMITS",x[x.VIEW_SPECIFIED=3]="VIEW_SPECIFIED",x[x.WINDOW_SPECIFIED=4]="WINDOW_SPECIFIED",x[x.LAYOUT_INFORMATION=5]="LAYOUT_INFORMATION",(F=e3||(e3={}))[F.AS_DISPLAYED=0]="AS_DISPLAYED",F[F.WIREFRAME=1]="WIREFRAME",F[F.HIDDEN=2]="HIDDEN",F[F.RENDERED=3]="RENDERED",(w=e7||(e7={}))[w.DRAFT=0]="DRAFT",w[w.PREVIEW=1]="PREVIEW",w[w.NORMAL=2]="NORMAL",w[w.PRESENTATION=3]="PRESENTATION",w[w.MAXIMUM=4]="MAXIMUM",w[w.CUSTOM=5]="CUSTOM";let rw=[{code:333,name:"shadePlotId",parser:u},{code:346,name:"orthographicUcsId",parser:u},{code:345,name:"namedUcsId",parser:u},{code:331,name:"viewportId",parser:u},{code:330,name:"paperSpaceTableId",parser:u},{code:76,name:"orthographicType",parser:u},{code:17,name:"ucsYAxis",parser:p},{code:16,name:"ucsXAxis",parser:p},{code:13,name:"ucsOrigin",parser:p},{code:146,name:"elevation",parser:u},{code:15,name:"maxExtent",parser:p},{code:14,name:"minExtent",parser:p},{code:12,name:"insertionBase",parser:p},{code:11,name:"maxLimit",parser:p},{code:10,name:"minLimit",parser:p},{code:71,name:"tabOrder",parser:u},{code:70,name:"controlFlag",parser:u},{code:1,name:"layoutName",parser:u},{code:100,name:"subclassMarker",parser:u},...rF];(V=e5||(e5={}))[V.PSLTSCALE=1]="PSLTSCALE",V[V.LIMCHECK=2]="LIMCHECK";let rV=[{code:330,name:"ownerObjectId",parser:u},{code:102},{code:360,name:"ownerDictionaryIdHard",parser:u},{code:102},{code:102},{code:330,name:"ownerDictionaryIdSoft",parser:u},{code:102},{code:102},{code:102},{code:5,name:"handle",parser:u}],rB=[{code:3,name:"entries",parser:(e,a)=>{let r={name:e.value};return 350===(e=a.next()).code?r.objectId=e.value:a.rewind(),r},isMultiple:!0},{code:281,name:"recordCloneFlag",parser:u},{code:280,name:"isHardOwned",parser:m},{code:100,name:"subclassMarker",parser:u}];function rH(e){return "AcDbDictionary"===e.subclassMarker}(B=e6||(e6={}))[B.NOT_APPLICABLE=0]="NOT_APPLICABLE",B[B.KEEP_EXISTING=1]="KEEP_EXISTING",B[B.USE_CLONE=2]="USE_CLONE",B[B.XREF_VALUE_NAME=3]="XREF_VALUE_NAME",B[B.VALUE_NAME=4]="VALUE_NAME",B[B.UNMANGLE_NAME=5]="UNMANGLE_NAME";let rG={LAYOUT:rw,PLOTSETTINGS:rF,DICTIONARY:rB};function rU(e,a){let r=[];for(;0!==e.code||!["EOF","ENDSEC"].includes(e.value);){let t=e.value,n=rG[t];if(0===e.code&&n?.length){let o=d([...rV,...n]),s={name:t};o(e=a.next(),a,s)?(r.push(s),e=a.peek()):e=a.next();}else e=a.next();}return {byName:a7(r,({name:e})=>e),byTree:function(e){let a=Object.fromEntries(e.map(e=>[e.handle,e]));for(let r of e)(!rH(r)||"0"!==r.ownerDictionaryIdSoft)&&(r.ownerDictionaryIdSoft&&(r.ownerDictionarySoft=a[r.ownerDictionaryIdSoft]),r.ownerDictionaryIdHard&&(r.ownerDictionaryHard=a[r.ownerDictionaryIdHard]),r.ownerObjectId&&(r.ownerObject=a[r.ownerObjectId])),function(e,a){rH(e)&&e.entries&&(e.entries=Object.fromEntries(e.entries.map(({name:e,objectId:r})=>[e,a[r]])));}(r,a);return e[0]}(r)}}let rY=[{code:100,name:"subclassMarker",parser:u},{code:330,name:"ownerObjectId",parser:u},{code:102,parser(e,a){for(;!i(e,0,"EOF")&&!i(e,102,"}");)e=a.next();}},{code:5,name:"handle",parser:u}],rW=d([{code:310,name:"bmpPreview",parser:u},{code:281,name:"scalability",parser:u},{code:280,name:"explodability",parser:u},{code:70,name:"insertionUnits",parser:u},{code:340,name:"layoutObjects",parser:u},{code:2,name:"name",parser:u},{code:100,name:"subclassMarker",parser:u},...rY]),rj=d([...[{name:"DIMPOST",code:3},{name:"DIMAPOST",code:4},{name:"DIMBLK_OBSOLETE",code:5},{name:"DIMBLK1_OBSOLETE",code:6},{name:"DIMBLK2_OBSOLETE",code:7},{name:"DIMSCALE",code:40,defaultValue:1},{name:"DIMASZ",code:41,defaultValue:.25},{name:"DIMEXO",code:42,defaultValue:.625,defaultValueImperial:.0625},{name:"DIMDLI",code:43,defaultValue:3.75,defaultValueImperial:.38},{name:"DIMEXE",code:44,defaultValue:2.25,defaultValueImperial:.28},{name:"DIMRND",code:45,defaultValue:0},{name:"DIMDLE",code:46,defaultValue:0},{name:"DIMTP",code:47,defaultValue:0},{name:"DIMTM",code:48,defaultValue:0},{name:"DIMTXT",code:140,defaultValue:2.5,defaultValueImperial:.28},{name:"DIMCEN",code:141,defaultValue:2.5,defaultValueImperial:.09},{name:"DIMTSZ",code:142,defaultValue:0},{name:"DIMALTF",code:143,defaultValue:25.4},{name:"DIMLFAC",code:144,defaultValue:1},{name:"DIMTVP",code:145,defaultValue:0},{name:"DIMTFAC",code:146,defaultValue:1},{name:"DIMGAP",code:147,defaultValue:.625,defaultValueImperial:.09},{name:"DIMALTRND",code:148,defaultValue:0},{name:"DIMTOL",code:71,defaultValue:0,defaultValueImperial:1},{name:"DIMLIM",code:72,defaultValue:0},{name:"DIMTIH",code:73,defaultValue:0,defaultValueImperial:1},{name:"DIMTOH",code:74,defaultValue:0,defaultValueImperial:1},{name:"DIMSE1",code:75,defaultValue:0},{name:"DIMSE2",code:76,defaultValue:0},{name:"DIMTAD",code:77,defaultValue:eT.Above,defaultValueImperial:eT.Center},{name:"DIMZIN",code:78,defaultValue:eD.Trailing,defaultValueImperial:eD.Feet},{name:"DIMAZIN",code:79,defaultValue:eO.None},{name:"DIMALT",code:170,defaultValue:0},{name:"DIMALTD",code:171,defaultValue:3,defaultValueImperial:2},{name:"DIMTOFL",code:172,defaultValue:1,defaultValueImperial:0},{name:"DIMSAH",code:173,defaultValue:0},{name:"DIMTIX",code:174,defaultValue:0},{name:"DIMSOXD",code:175,defaultValue:0},{name:"DIMCLRD",code:176,defaultValue:0},{name:"DIMCLRE",code:177,defaultValue:0},{name:"DIMCLRT",code:178,defaultValue:0},{name:"DIMADEC",code:179},{name:"DIMUNIT",code:270},{name:"DIMDEC",code:271,defaultValue:2,defaultValueImperial:4},{name:"DIMTDEC",code:272,defaultValue:2,defaultValueImperial:4},{name:"DIMALTU",code:273,defaultValue:2},{name:"DIMALTTD",code:274,defaultValue:2,defaultValueImperial:4},{name:"DIMAUNIT",code:275,defaultValue:0},{name:"DIMFRAC",code:276,defaultValue:0},{name:"DIMLUNIT",code:277,defaultValue:2},{name:"DIMDSEP",code:278,defaultValue:",",defaultValueImperial:"."},{name:"DIMJUST",code:280,defaultValue:eS.Center},{name:"DIMSD1",code:281,defaultValue:0},{name:"DIMSD2",code:282,defaultValue:0},{name:"DIMTOLJ",code:283,defaultValue:eN.Center},{name:"DIMTZIN",code:284,defaultValue:eD.Trailing,defaultValueImperial:eD.Feet},{name:"DIMALTZ",code:285,defaultValue:eD.Trailing},{name:"DIMALTTZ",code:286,defaultValue:eD.Trailing},{name:"DIMFIT",code:287},{name:"DIMUPT",code:288,defaultValue:0},{name:"DIMATFIT",code:289,defaultValue:3},{name:"DIMTXSTY",code:340},{name:"DIMLDRBLK",code:341},{name:"DIMBLK",code:342},{name:"DIMBLK1",code:343},{name:"DIMBLK2",code:344},{name:"DIMLWD",code:371,defaultValue:-2},{name:"DIMLWD",code:372,defaultValue:-2}].map(e=>({...e,parser:u})),{code:70,name:"standardFlag",parser:u},{code:2,name:"name",parser:u},{code:100,name:"subclassMarker",parser:u},{code:105,name:"handle",parser:u},...rY.filter(e=>5!==e.code)]),rX=d([{code:347,name:"materialObjectId",parser:u},{code:390,name:"plotStyleNameObjectId",parser:u},{code:370,name:"lineweight",parser:u},{code:290,name:"isPlotting",parser:m},{code:6,name:"lineType",parser:u},{code:62,name:"colorIndex",parser:u},{code:70,name:"standardFlag",parser:u},{code:2,name:"name",parser:u},{code:100,name:"subclassMarker",parser:u},...rY]),rz=d([{code:9,name:"text",parser:u},{code:45,name:"offsetY",parser:u},{code:44,name:"offsetX",parser:u},{code:50,name:"rotation",parser:u},{code:46,name:"scale",parser:u},{code:340,name:"styleObjectId",parser:u},{code:75,name:"shapeNumber",parser:u},{code:74,name:"elementTypeFlag",parser:u},{code:49,name:"elementLength",parser:u}],{elementTypeFlag:0,elementLength:0}),rK={BLOCK_RECORD:rW,DIMSTYLE:rj,LAYER:rX,LTYPE:d([{code:49,name:"pattern",parser(e,a){let r={};return rz(e,a,r),r},isMultiple:!0},{code:40,name:"totalPatternLength",parser:u},{code:73,name:"numberOfLineTypes",parser:u},{code:72,parser:u},{code:3,name:"description",parser:u},{code:70,name:"standardFlag",parser:u},{code:2,name:"name",parser:u},{code:100,name:"subclassMarker",parser:u},...rY]),STYLE:d([{code:1e3,name:"extendedFont",parser:u},{code:1001},{code:4,name:"bigFont",parser:u},{code:3,name:"font",parser:u},{code:42,name:"lastHeight",parser:u},{code:71,name:"textGenerationFlag",parser:u},{code:50,name:"obliqueAngle",parser:u},{code:41,name:"widthFactor",parser:u},{code:40,name:"fixedTextHeight",parser:u},{code:70,name:"standardFlag",parser:u},{code:2,name:"name",parser:u},{code:100,name:"subclassMarker",parser:u},...rY]),VPORT:d([{code:[63,421,431],name:"ambientColor",parser:u},{code:142,name:"contrast",parser:u},{code:141,name:"brightness",parser:u},{code:282,name:"defaultLightingType",parser:u},{code:292,name:"isDefaultLightingOn",parser:m},{code:348,name:"visualStyleObjectId",parser:u},{code:333,name:"shadePlotObjectId",parser:u},{code:332,name:"backgroundObjectId",parser:u},{code:61,name:"majorGridLines",parser:u},{code:170,name:"shadePlotSetting",parser:u},{code:146,name:"elevation",parser:u},{code:79,name:"orthographicType",parser:u},{code:112,name:"ucsYAxis",parser:p},{code:111,name:"ucsXAxis",parser:p},{code:110,name:"ucsOrigin",parser:p},{code:74,name:"ucsIconSetting",parser:u},{code:71,name:"viewMode",parser:u},{code:281,name:"renderMode",parser:u},{code:1,name:"styleSheet",parser:u},{code:[331,441],name:"frozenLayers",parser:u,isMultiple:!0},{code:72,name:"circleSides",parser:u},{code:51,name:"viewTwistAngle",parser:u},{code:50,name:"snapRotationAngle",parser:u},{code:45,name:"viewHeight",parser:u},{code:44,name:"backClippingPlane",parser:u},{code:43,name:"frontClippingPlane",parser:u},{code:42,name:"lensLength",parser:u},{code:17,name:"viewTarget",parser:p},{code:16,name:"viewDirectionFromTarget",parser:p},{code:15,name:"gridSpacing",parser:p},{code:14,name:"snapSpacing",parser:p},{code:13,name:"snapBasePoint",parser:p},{code:12,name:"center",parser:p},{code:11,name:"upperRightCorner",parser:p},{code:10,name:"lowerLeftCorner",parser:p},{code:70,name:"standardFlag",parser:u},{code:2,name:"name",parser:u},{code:100,name:"subclassMarker",parser:u},...rY])},rZ=d([{code:70,name:"maxNumberOfEntries",parser:u},{code:100,name:"subclassMarker",parser:u},{code:330,name:"ownerObjectId",parser:u},{code:102},{code:360,isMultiple:!0},{code:102},{code:5,name:"handle",parser:u},{code:2,name:"name",parser:u}]);function rJ(e,a){let r={};for(;!i(e,0,"EOF")&&!i(e,0,"ENDSEC");){if(i(e,0,"TABLE")){e=a.next();let t={entries:[]};rZ(e,a,t),r[t.name]=t;}if(i(e,0)&&!i(e,0,"ENDTAB")){let t=e.value;e=a.next();let n=rK[t];if(!n){console.warn(`parseTable: Invalid table name '${t}'`),e=a.next();continue}let o={};n(e,a,o),r[t]?.entries.push(o);}e=a.next();}return r}function r$(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}class rq{next(){if(!this.hasNext())return this._eof?console.warn("Cannot call 'next' after EOF group has been read"):console.warn("Unexpected end of input: EOF group not read before end of file. Ended on code "+this._data[this._pointer]),{code:0,value:"EOF"};let e=parseInt(this._data[this._pointer++],10),a=rQ(e,this._data[this._pointer++]),r={code:e,value:a};return i(r,0,"EOF")&&(this._eof=!0),this.lastReadGroup=r,r}peek(){if(!this.hasNext()){if(this._eof)throw Error("Cannot call 'next' after EOF group has been read");throw Error("Unexpected end of input: EOF group not read before end of file. Ended on code "+this._data[this._pointer])}let e={code:parseInt(this._data[this._pointer]),value:0};return e.value=rQ(e.code,this._data[this._pointer+1]),e}rewind(e){e=e||1,this._pointer=this._pointer-2*e;}hasNext(){return !this._eof&&!(this._pointer>this._data.length-2)}isEOF(){return this._eof}constructor(e){r$(this,"_pointer",void 0),r$(this,"_data",void 0),r$(this,"_eof",void 0),r$(this,"lastReadGroup",{code:0,value:0}),this._pointer=0,this._data=e,this._eof=!1;}}function rQ(e,a){return e<=9?a:e>=10&&e<=59?parseFloat(a.trim()):e>=60&&e<=99?parseInt(a.trim()):e>=100&&e<=109?a:e>=110&&e<=149?parseFloat(a.trim()):e>=160&&e<=179?parseInt(a.trim()):e>=210&&e<=239?parseFloat(a.trim()):e>=270&&e<=289?parseInt(a.trim()):e>=290&&e<=299?function(e){if("0"===e)return !1;if("1"===e)return !0;throw TypeError("String '"+e+"' cannot be cast to Boolean type")}(a.trim()):e>=300&&e<=369?a:e>=370&&e<=389?parseInt(a.trim()):e>=390&&e<=399?a:e>=400&&e<=409?parseInt(a.trim()):e>=410&&e<=419?a:e>=420&&e<=429?parseInt(a.trim()):e>=430&&e<=439?a:e>=440&&e<=459?parseInt(a.trim()):e>=460&&e<=469?parseFloat(a.trim()):e>=470&&e<=481||999===e||e>=1e3&&e<=1009?a:e>=1010&&e<=1059?parseFloat(a.trim()):e>=1060&&e<=1071?parseInt(a.trim()):(console.log("WARNING: Group code does not have a defined type: %j",{code:e,value:a}),a)}function r0(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}class r1{parseStart(e){this.startCode=e.code;}setPoint(e){if(this.code=e.code,this.value=e.value,this.startCode===this.code&&(this.x=this.value),this.startCode===this.code+10)this.y=this.value;else {let e={x:this.x??0,y:this.y??0,z:this.z??0};return this.reset(),e}if(this.startCode===this.code+20)this.z=this.value;else {let e={x:this.x??0,y:this.y??0,z:this.z??0};return this.reset(),e}}reset(){this.x=void 0,this.y=void 0,this.z=void 0;}constructor(){r0(this,"point",{}),r0(this,"startCode",0),r0(this,"code",0),r0(this,"value",0),r0(this,"x",void 0),r0(this,"y",void 0),r0(this,"z",void 0);}}function r4(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}class r2{constructor(){r4(this,"encoding","utf-8"),r4(this,"encodingFailureFatal",!1);}}class r3 extends Error{constructor(e,a,r){let t=`[Line ${a}]: ${e}`;r?.cause&&(t+=`
Caused by ${r.cause.toString()}
${r.cause.stack}`),super(t),r4(this,"line",void 0),this.line=a;}}class r7 extends EventTarget{Feed(e,a=!1){let r=this._decoder.decode(e??void 0,{stream:!a});this.FeedString(r,a);}FeedString(e,a=!1){if(this._finalChunkSeen)throw Error("Data fed after final chunk processed");a&&(this._finalChunkSeen=!0),this._curChunk+=e,this._ProcessCurChunk(),a&&this._Finalize();}_Finalize(){}async FeedFile(e,a){let r=e.byteLength;for(let t=0;t<r;t+=65536){a?.throwIfAborted();let n=Math.min(r-t,65536),o=await e.slice(t,t+n);this.Feed(o,t+n>=r);}}_ProcessCurChunk(){for(let e of this._ConsumeCurChunkLines())if(this._ProcessLine(e),this._curLineNum++,!this._eof&&"HEADER"===this._curSection){let e=this._curValue.value;9===this._curValue.code?this._currVarName=e:10===this._curValue.code?this._pointParser.parseStart(this._curValue):this._pointParser.startCode===this._curValue.code||this._pointParser.startCode+10===this._curValue.code||this._pointParser.startCode+20===this._curValue.code?e=this._pointParser.setPoint(this._curValue):this._currVarName&&(this.dxf.header[this._currVarName]=e);}}*_ConsumeCurChunkLines(){let e=0,a=this._curChunk.length;for(;e<a;){let r=this._curChunk.indexOf("\r",e),t=0;if(r>=0?(t=r+1)<a&&"\n"==this._curChunk.charAt(t)&&t++:(r=this._curChunk.indexOf("\n",e))>=0&&(t=r+1),r<0)break;yield this._curChunk.substring(e,r),e=t;}0!=e&&(this._curChunk=this._curChunk.substring(e));}_ProcessLine(e){if(null===this._curGroupCode){let a=e.trim();this._curGroupCode=parseInt(a),isNaN(this._curGroupCode)&&this._Error("Bad group code: "+a);return}let a=new r5(this._curGroupCode,e);if(!i(a,0,"EOF")){switch(a.value){case"SECTION":this._curSection="SECTION";break;case"HEADER":this._curSection="HEADER";break;case"BLOCKS":this._curSection="BLOCKS";break;case"ENTITIES":this._curSection="ENTITIES";break;case"TABLES":this._curSection="TABLES";break;case"OBJECTS":this._curSection="OBJECTS";}this._eof=!1;}i(a,0,"EOF")&&(this._eof=!0),this._curValue=a,this._curGroupCode=null;}_Error(e,a=null){let r;throw a&&(r={cause:a}),new r3(e,this._curLineNum,r)}constructor(e=new r2){super(),r4(this,"dxf",{header:{},blocks:{},entities:[],tables:{},objects:{byName:{},byTree:void 0}}),r4(this,"_decoder",void 0),r4(this,"_pointParser",void 0),r4(this,"_finalChunkSeen",!1),r4(this,"_curChunk",""),r4(this,"_curGroupCode",null),r4(this,"_curLineNum",1),r4(this,"_eof",!1),r4(this,"_curValue",{code:0,value:0}),r4(this,"_curSection",""),r4(this,"_currVarName",""),this._decoder=new TextDecoder(e.encoding,{fatal:e.encodingFailureFatal}),this._pointParser=new r1;}}class r5{constructor(e,a){r4(this,"code",void 0),r4(this,"value",void 0),this.code=e,this.value=rQ(e,a);}}function r6(e){return "INSERT"===e.type||"DIMENSION"===e.type&&!!e.name}function r9(e,a,r){return a in e?Object.defineProperty(e,a,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[a]=r,e}class r8{constructor(){r9(this,"encoding","utf-8"),r9(this,"encodingFailureFatal",!1);}}class te extends EventTarget{parseSync(e){let a=new rq(e.split(/\r\n|\r|\n/g));if(!a.hasNext())throw Error("Empty file");return this.parseAll(a)}parseStream(e){let a="",r=this;return new Promise((t,n)=>{e.on("data",e=>{a+=e;}),e.on("end",()=>{try{let e=a.split(/\r\n|\r|\n/g),n=new rq(e);if(!n.hasNext())throw Error("Empty file");t(r.parseAll(n));}catch(e){n(e);}}),e.on("error",e=>{n(e);});})}async parseFromUrl(e,a){let r=await fetch(e,a);if(!r.body)return null;let t=r.body.getReader(),n="";for(;;){let{done:e,value:a}=await t.read();if(e){n+=this._decoder.decode(new ArrayBuffer(0),{stream:!1});break}n+=this._decoder.decode(a,{stream:!0});}return this.parseSync(n)}parseAll(r){let t={header:{},blocks:{},entities:[],tables:{},objects:{byName:{},byTree:void 0}},n=r.next();for(;!i(n,0,"EOF");)i(n,0,"SECTION")&&(i(n=r.next(),2,"HEADER")?(n=r.next(),t.header=rx(n,r)):i(n,2,"BLOCKS")?(n=r.next(),t.blocks=rR(n,r)):i(n,2,"ENTITIES")?(n=r.next(),t.entities=rv(n,r)):i(n,2,"TABLES")?(n=r.next(),t.tables=rJ(n,r)):i(n,2,"OBJECTS")&&(n=r.next(),t.objects=rU(n,r))),n=r.next();return function(r){let t=Object.entries(r.blocks),n={};for(let[a,r]of filter(([e,a])=>a.entities?.some(r6),t))for(let e of r.entities??[])r6(e)&&(n[a]??(n[a]=[]),n[a].push(e.name));let o=a3({seeds:[...map(({name:e})=>e,filter(r6,r.entities))],serializer:e=>e,spanner:e=>n[e]??[]}).flat();return {...r,blocks:Object.fromEntries(o.map(e=>[e,r.blocks[e]]))}}(t)}constructor(e=new r8){super(),r9(this,"_decoder",void 0),this._decoder=new TextDecoder(e.encoding,{fatal:e.encodingFailureFatal});}}

    var DxfJson = /*#__PURE__*/Object.freeze({
        __proto__: null,
        ArcEntityParser: al,
        AttDefEntityParser: af,
        get AttDefMTextFlag () { return eW; },
        get AttachmentPoint () { return ef; },
        get AttributeFlag () { return eY; },
        get BlockTypeFlag () { return eE; },
        get BoundaryPathEdgeType () { return ev; },
        get BoundaryPathTypeFlag () { return eM; },
        CircleEntityParser: aO,
        get ColorCode () { return eI; },
        CommonEntitySnippets: an,
        DefaultDxfHeaderVariables: o,
        get DefaultLightingType () { return eG; },
        DefaultTextEntity: au,
        get DimensionTextHorizontal () { return eS; },
        get DimensionTextLineSpacing () { return eb; },
        get DimensionTextVertical () { return eT; },
        get DimensionToleranceTextVertical () { return eN; },
        get DimensionType () { return eh; },
        get DimensionZeroSuppression () { return eD; },
        get DimensionZeroSuppressionAngular () { return eO; },
        DxfParsingError: r3,
        DxfStreamParser: r7,
        DxfStreamParserOptions: r2,
        EllipseEntityParser: aL,
        get HatchAssociativity () { return e_; },
        get HatchBoundaryAnnotation () { return ey; },
        HatchEntityParser: aH,
        get HatchGradientColorFlag () { return eC; },
        get HatchGradientFlag () { return eP; },
        get HatchPatternType () { return eA; },
        get HatchSolidFill () { return eg; },
        get HatchStyle () { return eL; },
        INDEXED_CHUNK_SIZE: s,
        InsertEntityParser: aW,
        get LWPolylineFlag () { return eZ; },
        LWPolylineParser: a2,
        get LeaderCreationFlag () { return eK; },
        LeaderEntityParser: aK,
        LineEntityParser: aq,
        get MTextDrawingDirection () { return eJ; },
        MTextEntityParser: ra,
        MTextEntityParserSnippets: re,
        get Measurement () { return ex; },
        get ObscuredLineTypes () { return eR; },
        get OrthographicType () { return eB; },
        PointEntityParser: ro,
        get PolylineFlag () { return e$; },
        PolylineParser: rm,
        get RenderMode () { return ew; },
        get ReservedLineweight () { return ek; },
        SPLINE_SUBDIVISION: t,
        SectionEntityParser: rf,
        get ShadePlotMode () { return eH; },
        get ShadowMode () { return eU; },
        get SmoothType () { return eq; },
        SolidEntityParser: rO,
        SplineEntityParser: r_,
        get SplineFlag () { return e0; },
        TESSELLATION_ANGLE: n,
        TextEntityParser: am,
        TextEntityParserSnippets: ap,
        get TextGenerationFlag () { return ej; },
        get TextHorizontalAlign () { return eX; },
        get TextVerticalAlign () { return ez; },
        get UCSPerViewport () { return eV; },
        UndeterminedBlockColor: r,
        get VertexFlag () { return eQ; },
        VertexParser: rl,
        get ViewportStatusFlag () { return eF; },
        classify: a7,
        default: te,
        ensureHandle: at,
        ensurePoint3D: a6,
        flooding: a3,
        generateIntegers: a5,
        isMatched: i,
        parseBlock: rk,
        parseBlocks: rR,
        parseEntities: rv,
        parseHeader: rx,
        parseObjects: rU,
        parseTables: rJ,
        skipApplicationGroups: ao
    });

    return DxfJson;

}));
