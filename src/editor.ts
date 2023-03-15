import * as THREE from 'three'
import {
    Bone,
    MeshDepthMaterial,
    MeshNormalMaterial,
    MeshPhongMaterial,
    Object3D,
    Skeleton,
    SkinnedMesh,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls'

// @ts-ignore
// import {
//     CCDIKHelper,
//     CCDIKSolver,
//     IKS,
// } from 'three/examples/jsm/animate/CCDIKSolver'

import {
    BodyControlor,
    CloneBody,
    CreateTemplateBody,
    GetExtremityMesh,
    IsExtremities,
    IsFoot,
    IsHand,
    IsNeedSaveObject,
    IsPickable,
    LoadFoot,
    LoadHand,
} from './body'
import { options } from './config'
import { SetScreenShot } from './image'
import { download, downloadJson, getCurrentTime, uploadJson } from './util'

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

import { LuminosityShader } from 'three/examples/jsm/shaders/LuminosityShader.js'
import { SobelOperatorShader } from 'three/examples/jsm/shaders/SobelOperatorShader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils'
import Swal from 'sweetalert2'
import { FindObjectItem } from './three-utils'

interface BodyData {
    position: ReturnType<THREE.Vector3['toArray']>
    rotation: ReturnType<THREE.Euler['toArray']>
    scale: ReturnType<THREE.Vector3['toArray']>

    child: Record<
        string,
        {
            position: ReturnType<THREE.Vector3['toArray']>
            rotation: ReturnType<THREE.Euler['toArray']>
            scale: ReturnType<THREE.Vector3['toArray']>
        }
    >
}

interface CameraData {
    position: ReturnType<THREE.Vector3['toArray']>
    rotation: ReturnType<THREE.Euler['toArray']>
    near: number
    far: number
    zoom: number
}

type EditorSelectEventHandler = (controlor: BodyControlor) => void
type EditorUnselectEventHandler = () => void

export class BodyEditor {
    renderer: THREE.WebGLRenderer
    outputRenderer: THREE.WebGLRenderer
    scene: THREE.Scene
    gridHelper: THREE.GridHelper
    axesHelper: THREE.AxesHelper
    camera: THREE.PerspectiveCamera
    orbitControls: OrbitControls
    transformControl: TransformControls

    dlight: THREE.DirectionalLight
    alight: THREE.AmbientLight
    raycaster = new THREE.Raycaster()
    IsClick = false

    // ikSolver?: CCDIKSolver
    composer?: EffectComposer
    effectSobel?: ShaderPass
    enableComposer = false
    enablePreview = true

    paused = false

    constructor(canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            // logarithmicDepthBuffer: true
        })
        this.outputRenderer = new THREE.WebGLRenderer({
            antialias: true,
            // logarithmicDepthBuffer: true
        })
        this.outputRenderer.domElement.style.display = 'none'
        document.body.appendChild(this.outputRenderer.domElement)

        this.renderer.setClearColor(options.clearColor, 0.0)
        this.scene = new THREE.Scene()

        this.gridHelper = new THREE.GridHelper(800, 200)
        this.axesHelper = new THREE.AxesHelper(1000)
        this.scene.add(this.gridHelper)
        this.scene.add(this.axesHelper)

        const aspect = window.innerWidth / window.innerHeight

        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000)

        this.camera.position.set(0, 100, 200)
        this.camera.lookAt(0, 100, 0)
        // this.camera.near = 130
        // this.camera.far = 600
        this.camera.updateProjectionMatrix()

        this.orbitControls = new OrbitControls(
            this.camera,
            this.renderer.domElement
        )
        this.orbitControls.target = new THREE.Vector3(0, 100, 0)
        this.orbitControls.update()

        this.transformControl = new TransformControls(
            this.camera,
            this.renderer.domElement
        )

        this.transformControl.setMode('rotate') //旋转
        // transformControl.setSize(0.4);
        this.transformControl.setSpace('local')
        this.transformControl.addEventListener('change', () => {
            // this.renderer.render(this.scene, this.camera)
        })

        this.transformControl.addEventListener('mouseDown', () => {
            this.orbitControls.enabled = false
        })
        this.transformControl.addEventListener('mouseUp', () => {
            this.orbitControls.enabled = true
        })

        this.scene.add(this.transformControl)

        // Light
        this.dlight = new THREE.DirectionalLight(0xffffff, 1.0)
        this.dlight.position.set(0, 160, 1000)
        this.scene.add(this.dlight)
        this.alight = new THREE.AmbientLight(0xffffff, 0.5)
        this.scene.add(this.alight)

        this.renderer.domElement.addEventListener(
            'mousedown',
            () => (this.IsClick = true),
            false
        )
        this.renderer.domElement.addEventListener(
            'mousemove',
            () => (this.IsClick = false),
            false
        )
        this.renderer.domElement.addEventListener(
            'mouseup',
            this.onMouseDown.bind(this),
            false
        )

        this.renderer.domElement.addEventListener(
            'resize',
            this.handleResize.bind(this)
        )

        this.initEdgeComposer()

        // // Create a render target with depth texture
        // this.setupRenderTarget();

        // // Setup post-processing step
        // this.setupPost();

        this.animate()
        this.handleResize()
        this.AutoSaveScene()
    }

    render(width: number = this.Width, height: number = this.Height) {
        // this.ikSolver?.update()

        this.renderer.setViewport(0, 0, width, height)
        this.renderer.setScissor(0, 0, width, height)
        this.renderer.setScissorTest(true)

        this.renderer.render(this.scene, this.camera)
    }

    renderPreview() {
        const outputWidth = options.autoSize ? this.Width : options.Width
        const outputHeight = options.autoSize ? this.Height : options.Height

        const outputAspect = outputWidth / outputHeight
        const maxOutoutAspect = 2
        const [left, bottom, width, height] =
            outputAspect > maxOutoutAspect
                ? [
                      this.Width - 50 - 150 * maxOutoutAspect,
                      220,
                      150 * maxOutoutAspect,
                      (150 * maxOutoutAspect * outputHeight) / outputWidth,
                  ]
                : [
                      this.Width - 50 - (150 * outputWidth) / outputHeight,
                      220,
                      (150 * outputWidth) / outputHeight,
                      150,
                  ]
        const save = {
            viewport: new THREE.Vector4(),
            scissor: new THREE.Vector4(),
            scissorTest: this.renderer.getScissorTest(),
            aspect: this.camera.aspect,
        }

        this.renderer.getViewport(save.viewport)
        this.renderer.getScissor(save.viewport)

        this.renderer.setViewport(left, bottom, width, height)
        this.renderer.setScissor(left, bottom, width, height)
        this.renderer.setScissorTest(true)
        this.camera.aspect = width / height
        this.camera.updateProjectionMatrix()
        this.renderer.render(this.scene, this.camera)

        // restore
        this.renderer.setViewport(save.viewport)
        this.renderer.setScissor(save.scissor)
        this.renderer.setScissorTest(save.scissorTest)
        this.camera.aspect = save.aspect
        this.camera.updateProjectionMatrix()
    }

    renderOutput() {
        const outputWidth = options.autoSize ? this.Width : options.Width
        const outputHeight = options.autoSize ? this.Height : options.Height

        this.changeComposerResoultion(outputWidth, outputHeight)

        const save = {
            aspect: this.camera.aspect,
        }
        this.camera.aspect = outputWidth / outputHeight
        this.camera.updateProjectionMatrix()
        this.outputRenderer.setSize(outputWidth, outputHeight, true)

        if (this.enableComposer) {
            this.composer?.render()
        } else {
            this.outputRenderer.render(this.scene, this.camera)
        }

        this.camera.aspect = save.aspect
        this.camera.updateProjectionMatrix()
    }
    getOutputPNG() {
        return this.outputRenderer.domElement.toDataURL('image/png')
    }
    animate() {
        if (this.paused) {
            return
        }
        requestAnimationFrame(this.animate.bind(this))
        this.handleResize()
        this.render()
        if (this.enablePreview) this.renderPreview()
    }

    pause() {
        this.paused = true
    }

    resume() {
        this.paused = false
        this.animate()
    }

    getAncestors(o: Object3D) {
        const ancestors: Object3D[] = []
        o.traverseAncestors((ancestor) => ancestors.push(ancestor))
        return ancestors
    }
    getBodyByPart(o: Object3D) {
        if (o?.name === 'torso') return o

        const body =
            this.getAncestors(o).find((o) => o?.name === 'torso') ?? null
        return body
    }

    selectEventHandlers: EditorSelectEventHandler[] =
        [] as EditorSelectEventHandler[]
    unselectEventHandlers: EditorUnselectEventHandler[] =
        [] as EditorUnselectEventHandler[]
    RegisterEvent({
        select,
        unselect,
    }: {
        select?: EditorSelectEventHandler
        unselect?: EditorUnselectEventHandler
    }) {
        if (select) this.selectEventHandlers.push(select)
        if (unselect) this.unselectEventHandlers.push(unselect)
    }

    triggerSelectEvent(body: Object3D) {
        const c = new BodyControlor(body)
        this.selectEventHandlers.forEach((h) => h(c))
    }
    triggerUnselectEvent() {
        this.unselectEventHandlers.forEach((h) => h())
    }

    onMouseDown(event: MouseEvent) {
        const x = event.offsetX - this.renderer.domElement.offsetLeft
        const y = event.offsetY - this.renderer.domElement.offsetTop
        this.raycaster.setFromCamera(
            {
                x: (x / this.renderer.domElement.clientWidth) * 2 - 1,
                y: -(y / this.renderer.domElement.clientHeight) * 2 + 1,
            },
            this.camera
        )
        const intersects: THREE.Intersection[] =
            this.raycaster.intersectObjects(
                this.scene.children.filter((o) => o?.name === 'torso'),
                true
            )
        const intersectedObject: THREE.Object3D | null =
            intersects.length > 0 ? intersects[0].object : null
        const name = intersectedObject ? intersectedObject.name : ''
        let obj: Object3D | null = intersectedObject

        console.log(obj?.name)

        if (this.IsClick) {
            if (!obj) {
                this.transformControl.detach()
                this.triggerUnselectEvent()
                return
            }

            if (this.MoveMode) {
                obj = this.getBodyByPart(obj)

                if (obj) {
                    console.log(obj.name)
                    this.transformControl.setMode('translate')
                    this.transformControl.setSpace('world')
                    this.transformControl.attach(obj)
                    this.triggerSelectEvent(obj)
                }
            } else {
                const isOk = IsPickable(name)

                if (!isOk) {
                    obj =
                        this.getAncestors(obj).find((o) =>
                            IsPickable(o.name)
                        ) ?? null
                }

                if (obj) {
                    console.log(obj.name)
                    this.transformControl.setMode('rotate')
                    this.transformControl.setSpace('local')
                    this.transformControl.attach(obj)

                    const body = this.getBodyByPart(obj)
                    if (body) this.triggerSelectEvent(body)
                }
            }
        }
    }

    traverseHandObjecct(handle: (o: THREE.Mesh) => void) {
        this.scene.children
            .filter((o) => o?.name === 'torso')
            .forEach((o) => {
                o.traverse((child) => {
                    if (IsHand(child?.name)) {
                        handle(child as THREE.Mesh)
                    }
                })
            })
    }

    traverseExtremities(handle: (o: THREE.Mesh) => void) {
        this.scene.children
            .filter((o) => o?.name === 'torso')
            .forEach((o) => {
                o.traverse((child) => {
                    if (IsExtremities(child.name)) {
                        handle(child as THREE.Mesh)
                    }
                })
            })
    }

    hideExtremities() {
        const recoveryArr: Object3D[] = []
        this.traverseExtremities((o) => {
            if (o.visible == true) {
                o.visible = false

                recoveryArr.push(o)
            }
        })

        return () => {
            recoveryArr.forEach((o) => (o.visible = true))
        }
    }

    hideSkeleten() {
        const map = new Map<Object3D, Object3D | null>()

        this.scene.children
            .filter((o) => o?.name === 'torso')
            .forEach((o) => {
                o.traverse((child) => {
                    if (IsExtremities(child?.name)) {
                        map.set(child, child.parent)
                        this.scene.attach(child)
                    } else if (child?.name === 'red_point') {
                        child.visible = false
                    }
                })
                o.visible = false
            })
        return map
    }

    showSkeleten(map: Map<Object3D, Object3D | null>) {
        for (const [k, v] of map.entries()) {
            v?.attach(k)
        }

        this.scene.children
            .filter((o) => o?.name === 'torso')
            .forEach((o) => {
                o.traverse((child) => {
                    if (child?.name === 'red_point') {
                        child.visible = true
                    }
                })
                o.visible = true
            })
    }

    changeComposer(enable: boolean) {
        const save = this.enableComposer
        this.enableComposer = enable

        return () => (this.enableComposer = save)
    }

    changeHandMaterial(type: 'depth' | 'normal' | 'phone') {
        let initType = 'depth'
        this.traverseExtremities((child) => {
            const o = GetExtremityMesh(child)
            if (!o) return
            if (o.material) {
                if (o.material instanceof MeshNormalMaterial)
                    initType = 'normal'
                if (o.material instanceof MeshPhongMaterial) initType = 'phone'
            }

            if (type == 'depth') o.material = new MeshDepthMaterial()
            else if (type == 'normal') o.material = new MeshNormalMaterial()
            else if (type == 'phone') o.material = new MeshPhongMaterial()
        })

        return () => {
            this.traverseExtremities((child) => {
                const o = GetExtremityMesh(child)
                if (!o) return

                if (initType == 'depth') o.material = new MeshDepthMaterial()
                else if (initType == 'normal')
                    o.material = new MeshNormalMaterial()
                else if (initType == 'phone')
                    o.material = new MeshPhongMaterial()
            })
        }
    }

    // https://stackoverflow.com/questions/15696963/three-js-set-and-read-camera-look-vector?noredirect=1&lq=1
    getCameraLookAtVector() {
        const lookAtVector = new THREE.Vector3(0, 0, -1)
        lookAtVector.applyQuaternion(this.camera.quaternion)
        return lookAtVector
    }

    getZDistanceFromCamera(p: THREE.Vector3) {
        const lookAt = this.getCameraLookAtVector().normalize()
        const v = p.clone().sub(this.camera.position)
        return v.dot(lookAt)
    }
    changeCamera() {
        let hands: THREE.Mesh[] = []
        this.scene.traverse((o) => {
            if (this.OnlyHand) {
                if (IsHand(o?.name)) hands.push(o as THREE.Mesh)
            } else {
                if (IsExtremities(o?.name)) hands.push(o as THREE.Mesh)
            }
        })

        // filter object in frustum
        hands = this.objectInView(hands)

        const cameraPos = new THREE.Vector3()
        this.camera.getWorldPosition(cameraPos)

        const handsPos = hands.map((o) => {
            const cameraPos = new THREE.Vector3()
            o.getWorldPosition(cameraPos)
            return cameraPos
        })

        const handsDis = handsPos.map((pos) => {
            return this.getZDistanceFromCamera(pos)
        })

        const minDis = Math.min(...handsDis)
        const maxDis = Math.max(...handsDis)

        const saveNear = this.camera.near
        const saveFar = this.camera.far

        this.camera.near = Math.max(minDis - 20, 0)
        this.camera.far = Math.max(maxDis + 20, 20)
        console.log('camera', this.camera.near, this.camera.far)

        this.camera.updateProjectionMatrix()
        return () => {
            this.camera.near = saveNear
            this.camera.far = saveFar
            this.camera.updateProjectionMatrix()
        }
    }

    Capture() {
        const restoreExtremities = this.hideExtremities()

        this.renderOutput()
        const imgData = this.getOutputPNG()
        const fileName = 'pose_' + getCurrentTime()

        restoreExtremities()

        return {
            imgData,
            fileName,
        }
    }

    CaptureCanny() {
        const map = this.hideSkeleten()

        const restore = this.changeComposer(true)
        this.renderOutput()

        const imgData = this.getOutputPNG()
        const fileName = 'canny_' + getCurrentTime()

        this.showSkeleten(map)
        restore()

        return {
            imgData,
            fileName,
        }
    }

    CaptureNormal() {
        const restoreHand = this.changeHandMaterial('normal')
        const map = this.hideSkeleten()
        const restore = this.changeComposer(false)
        this.renderOutput()

        const imgData = this.getOutputPNG()
        const fileName = 'normal_' + getCurrentTime()

        this.showSkeleten(map)
        restore()
        restoreHand()

        return {
            imgData,
            fileName,
        }
    }

    CaptureDepth() {
        const restoreHand = this.changeHandMaterial('depth')
        const map = this.hideSkeleten()
        const restore = this.changeComposer(false)

        const restoreCamera = this.changeCamera()
        this.renderOutput()
        restoreCamera()

        const imgData = this.getOutputPNG()
        const fileName = 'depth_' + getCurrentTime()

        this.showSkeleten(map)
        restore()
        restoreHand()

        return {
            imgData,
            fileName,
        }
    }

    MakeImages() {
        this.renderer.setClearColor(0x000000)

        this.axesHelper.visible = false
        this.gridHelper.visible = false

        this.transformControl.detach()

        {
            const { imgData, fileName } = this.Capture()
            SetScreenShot('pose', imgData, fileName)
        }
        {
            const { imgData, fileName } = this.CaptureDepth()
            SetScreenShot('depth', imgData, fileName)
        }
        {
            const { imgData, fileName } = this.CaptureNormal()
            SetScreenShot('normal', imgData, fileName)
        }

        {
            const { imgData, fileName } = this.CaptureCanny()
            SetScreenShot('canny', imgData, fileName)
        }

        this.renderer.setClearColor(0x000000, 0)
        this.axesHelper.visible = true
        this.gridHelper.visible = true
    }

    CopyBodyZ() {
        const body = CloneBody()
        if (!body) return

        const list = this.scene.children
            .filter((o) => o?.name === 'torso')
            .filter((o) => o.position.x === 0)
            .map((o) => Math.ceil(o.position.z / 30))

        if (list.length > 0) body.translateZ((Math.min(...list) - 1) * 30)
        this.scene.add(body)
        this.fixFootVisible()
    }

    CopyBodyX() {
        const body = CloneBody()
        if (!body) return

        const list = this.scene.children
            .filter((o) => o?.name === 'torso')
            .filter((o) => o.position.z === 0)
            .map((o) => Math.ceil(o.position.x / 50))

        if (list.length > 0) body.translateX((Math.min(...list) - 1) * 50)
        this.scene.add(body)
        this.fixFootVisible()
    }

    getSelectedBody() {
        let obj: Object3D | null = this.transformControl.object ?? null
        obj = obj ? this.getBodyByPart(obj) : null

        return obj
    }
    RemoveBody() {
        const obj = this.getSelectedBody()

        if (obj) {
            console.log(obj.name)
            obj.removeFromParent()
            this.transformControl.detach()
        }
    }

    pointsInView(points: THREE.Vector3[]) {
        this.camera.updateMatrix() // make sure camera's local matrix is updated
        this.camera.updateMatrixWorld() // make sure camera's world matrix is updated

        const frustum = new THREE.Frustum().setFromProjectionMatrix(
            new THREE.Matrix4().multiplyMatrices(
                this.camera.projectionMatrix,
                this.camera.matrixWorldInverse
            )
        )

        //console.log(points);
        return points.filter((p) => frustum.containsPoint(p))
    }

    getBouningSphere(o: Object3D) {
        const bbox = new THREE.Box3().setFromObject(o, true)
        // const helper = new THREE.Box3Helper(bbox, new THREE.Color(0, 255, 0))
        // this.scene.add(helper)

        const center = new THREE.Vector3()
        bbox.getCenter(center)

        const bsphere = bbox.getBoundingSphere(new THREE.Sphere(center))

        return bsphere
    }
    objectInView<T extends Object3D>(objs: T[]) {
        this.camera.updateMatrix() // make sure camera's local matrix is updated
        this.camera.updateMatrixWorld() // make sure camera's world matrix is updated

        const frustum = new THREE.Frustum().setFromProjectionMatrix(
            new THREE.Matrix4().multiplyMatrices(
                this.camera.projectionMatrix,
                this.camera.matrixWorldInverse
            )
        )

        //console.log(points);
        return objs.filter((obj) => {
            const sphere = this.getBouningSphere(obj)
            return frustum.intersectsSphere(sphere)
        })
    }

    get MoveMode() {
        return this.transformControl.mode == 'translate'
    }
    set MoveMode(move: boolean) {
        this.transformControl.setMode(move ? 'translate' : 'rotate')

        if (move) {
            const obj = this.getSelectedBody()
            if (obj) this.transformControl.attach(obj)
        }
    }
    get Width() {
        return this.renderer.domElement.clientWidth
    }

    get Height() {
        return this.renderer.domElement.clientHeight
    }

    onlyHand = false
    get OnlyHand() {
        return this.onlyHand
    }

    set OnlyHand(value: boolean) {
        this.onlyHand = value
        this.setFootVisible(!this.onlyHand)
    }

    setFootVisible(value: boolean) {
        this.traverseExtremities((o) => {
            if (IsFoot(o.name)) {
                o.visible = value
            }
        })
    }

    fixFootVisible() {
        this.setFootVisible(!this.OnlyHand)
    }

    handleResize() {
        const size = new THREE.Vector2()
        this.renderer.getSize(size)

        if (size.width == this.Width && size.height === this.Height) return

        const canvas = this.renderer.domElement
        this.camera.aspect = canvas.clientWidth / canvas.clientHeight

        this.camera.updateProjectionMatrix()

        console.log(canvas.clientWidth, canvas.clientHeight)
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
        console.log(this.Width, this.Height)
    }

    initEdgeComposer() {
        this.composer = new EffectComposer(this.outputRenderer)
        const renderPass = new RenderPass(this.scene, this.camera)
        this.composer.addPass(renderPass)

        // color to grayscale conversion

        const effectGrayScale = new ShaderPass(LuminosityShader)
        this.composer.addPass(effectGrayScale)

        // you might want to use a gaussian blur filter before
        // the next pass to improve the result of the Sobel operator

        // Sobel operator

        const effectSobel = new ShaderPass(SobelOperatorShader)
        effectSobel.uniforms['resolution'].value.x =
            this.Width * window.devicePixelRatio
        effectSobel.uniforms['resolution'].value.y =
            this.Height * window.devicePixelRatio
        this.composer.addPass(effectSobel)
        this.effectSobel = effectSobel
    }

    changeComposerResoultion(width: number, height: number) {
        this.composer?.setSize(width, height)
        if (this.effectSobel) {
            this.effectSobel.uniforms['resolution'].value.x =
                width * window.devicePixelRatio
            this.effectSobel.uniforms['resolution'].value.y =
                height * window.devicePixelRatio
        }
    }

    async loadBodyData() {
        const hand = await LoadHand((loaded) => {
            if (loaded >= 100) {
                Swal.hideLoading()
                Swal.close()
            } else if (Swal.isVisible() == false) {
                Swal.fire({
                    didOpen: () => {
                        Swal.showLoading()
                    },
                })
            }
        })
        const foot = await LoadFoot((loaded) => {
            if (loaded >= 100) {
                Swal.hideLoading()
                Swal.close()
            } else if (Swal.isVisible() == false) {
                Swal.fire({
                    didOpen: () => {
                        Swal.showLoading()
                    },
                })
            }
        })
        CreateTemplateBody(hand, foot)
        // scene.add( object );
        const body = CloneBody()!

        this.scene.add(body)
        this.dlight.target = body
    }

    get CameraNear() {
        return this.camera.near
    }
    set CameraNear(value: number) {
        this.camera.near = value
        this.camera.updateProjectionMatrix()
    }

    get CameraFar() {
        return this.camera.far
    }
    set CameraFar(value: number) {
        this.camera.far = value
        this.camera.updateProjectionMatrix()
    }

    get CameraFocalLength() {
        return this.camera.getFocalLength()
    }
    set CameraFocalLength(value) {
        this.camera.setFocalLength(value)
    }

    GetBodyData(o: Object3D): BodyData {
        const result: BodyData = {
            position: o.position.toArray(),
            rotation: o.rotation.toArray(),
            scale: o.scale.toArray(),
            child: {},
        }
        o.traverse((child) => {
            if (child.name && IsNeedSaveObject(child.name)) {
                result.child[child.name] = {
                    position: child.position.toArray(),
                    rotation: child.rotation.toArray(),
                    scale: child.scale.toArray(),
                }
            }
        })

        return result
    }
    GetCameraData() {
        const result = {
            position: this.camera.position.toArray(),
            rotation: this.camera.rotation.toArray(),
            near: this.camera.near,
            far: this.camera.far,
            zoom: this.camera.zoom,
        }

        return result
    }
    GetSceneData() {
        const bodies = this.scene.children
            .filter((o) => o?.name === 'torso')
            .map((o) => this.GetBodyData(o))

        const data = {
            header: 'Openpose Editor by Yu Zhu',
            version: __APP_VERSION__,
            object: {
                bodies: bodies,
                camera: this.GetCameraData(),
            },
            setting: {},
        }

        return data
    }
    AutoSaveScene() {
        try {
            const rawData = localStorage.getItem('AutoSaveSceneData')
            if (rawData) {
                localStorage.setItem('LastSceneData', rawData)
            }
            setInterval(() => {
                localStorage.setItem(
                    'AutoSaveSceneData',
                    JSON.stringify(this.GetSceneData())
                )
            }, 5000)
        } catch (error) {
            console.error(error)
        }
    }

    SaveScene() {
        try {
            downloadJson(
                JSON.stringify(this.GetSceneData()),
                `scene_${getCurrentTime()}.json`
            )
        } catch (error) {
            console.error(error)
        }
    }

    ClearScene() {
        this.scene.children
            .filter((o) => o?.name === 'torso')
            .forEach((o) => o.removeFromParent())
    }

    CreateBodiesFromData(bodies: BodyData[]) {
        return bodies.map((data) => {
            const body = CloneBody()!

            body?.traverse((o) => {
                if (o.name && o.name in data.child) {
                    const child = data.child[o.name]
                    o.position.fromArray(child.position)
                    o.rotation.fromArray(child.rotation as any)
                    o.scale.fromArray(child.scale)
                }
            })
            body.position.fromArray(data.position)
            body.rotation.fromArray(data.rotation as any)
            body.scale.fromArray(data.scale)

            return body
        })
    }
    RestoreCamera(data: CameraData) {
        this.camera.position.fromArray(data.position)
        this.camera.rotation.fromArray(data.rotation as any)
        this.camera.near = data.near
        this.camera.far = data.far
        this.camera.zoom = data.zoom
        this.camera.updateProjectionMatrix()
        this.orbitControls.update() // fix position change
    }
    RestoreScene(rawData: string) {
        try {
            if (!rawData) return
            const data = JSON.parse(rawData)

            const {
                version,
                object: { bodies, camera },
                setting,
            } = data

            const bodiesObject = this.CreateBodiesFromData(bodies)
            this.ClearScene()

            if (bodiesObject.length > 0) this.scene.add(...bodiesObject)
            this.RestoreCamera(camera)
        } catch (error: any) {
            Swal.fire({
                icon: 'error',
                title: 'Oops...',
                text: 'Something went wrong!' + '\n' + error?.stack ?? error,
                footer: '<a href="https://github.com/ZhUyU1997/open-pose-editor/issues">If the problem persists, please click here to ask a question.</a>',
            })
            console.error(error)
        }
    }
    RestoreLastSavedScene() {
        const rawData = localStorage.getItem('LastSceneData')
        if (rawData) this.RestoreScene(rawData)
    }
    async LoadScene() {
        const rawData = await uploadJson()
        if (rawData) this.RestoreScene(rawData)
    }
}
